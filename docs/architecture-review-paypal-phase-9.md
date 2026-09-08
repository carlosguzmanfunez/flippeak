# Architecture Review — PayPal Funding (Phase 9)

**Estado:** ESPECIFICACIÓN PARA AUDITORÍA. **No integra PayPal, no crea el flujo Sandbox, no llama a ninguna API.**
**Cierre de fase: 4E aprobado.** Este documento es el producto del Paso 9. Decisión de implementación: tras auditoría.

---

## 0. Resumen ejecutivo

FlipPeak necesita una vía real de dinero para que los `run_funding` verificados dejen de ser
`internal` (mecanismo de prueba ya ADMIN-gated y **nunca una vía productiva**). PayPal Sandbox
será el primer provider. **La regla financiera absoluta se mantiene: el único autor funcional es
un evento webhook verificado server-to-server.** El retorno del navegador nunca acredita.

El modelo se construye sobre lo que ya existe: ledger `run_funding` (UNIQUE por evento de
provider — idempotencia de **evento**), activación transaccional (`activateRun`), motor canónico
(ADR-013). Lo que se añade es la capa de **órdenes** y la **idempotencia de captura financiera**,
que es de otro nivel que la de evento.

---

## 1. Estado de la decisión — ADR-014 (propuesto)

> **Decisión.** Los créditos financieros solo se originan en eventos webhook verificados
> server-to-server. Una **captura financiera** de PayPal (Capture ID) acredita exactamente una
> vez, se lea por uno o por muchos eventos distintos. El retorno del navegador solo navega; un
> GET de verificación del servidor puede **confirmar**, jamás **acreditar**.

Se propone añadir este texto como ADR-014 en `docs/architecture-decisions.md` cuando la
auditoría lo apruebe (conseguir no-fragmentar ADRs: una sola entrada).

---

## 2. Tres identificadores, tres niveles (no son equivalentes)

| Identificador | Qué es | Nivel de idempotencia | UNIQUE propuesto |
|---|---|---|---|
| **Order ID** | la transacción *intención* en PayPal (`CHECKOUT.ORDER.APPROVED`) | una orden nuestra se crea con un order id; 1:1 en creación | `UNIQUE(provider, provider_order_id)` parcial (not null) |
| **Capture ID** | la **captura financiera** — el dinero que se movió definitivamente | **nivel autoridad**: acredita una vez, siempre | `UNIQUE(provider, provider_capture_id)` parcial (not null) |
| **Webhook Event ID** | la entrega de un evento del proveedor | entregas duplicadas nunca se procesan dos veces | `UNIQUE(provider, provider_event_id)` en `payment_event` |

**La regla que el filtro exige:** la unicidad de captura **no** se deriva de la de evento. Dos
eventos distintos (`event_id` A y B) que porten la **misma** `capture_id` son legítimos (red no
garantiza orden ni entrega única); el segundo se registra con estado `DUPLICATE_CAPTURE` y NO
acredita. La idempotencia es el producto cartesiano de ambas: *evento entregado una vez* AND
*captura acreditada una vez*.

---

## 3. Modelo de datos propuesto (Paso 10 creará; aquí solo se especifica)

### 3.1 Tabla `payment_order` (1 run : N orders — un run puede tener varias órdenes; UNA activa)

```
id                  uuid PK, defaultRandom
run_id              uuid NOT NULL   → campaign_run(id)  ON DELETE restrict
state               text NOT NULL DEFAULT 'PENDING'
                    CHECK (state IN ('PENDING','APPROVED','CAPTURED','ABANDONED','REFUNDED'))
amount_cents        bigint NOT NULL
                    CHECK (amount_cents > 0)
                    CHECK (amount_cents <= 2501999793)      -- techo matemático exacto (ADR-011),
                                                            -- NO política comercial
currency            text NOT NULL DEFAULT 'USD' CHECK (currency = 'USD')
provider            text NOT NULL DEFAULT 'paypal'
provider_order_id   text      -- Order ID de PayPal
provider_capture_id text      -- Capture ID de PayPal
created_at / updated_at   timestamptz NOT NULL (updated_at via $onUpdate)
INDEXES: UNIQUE(provider, provider_order_id) WHERE provider_order_id IS NOT NULL
         UNIQUE(provider, provider_capture_id) WHERE provider_capture_id IS NOT NULL
         (run_id) para listados del owner
```

**Relación Payment ↔ CampaignRun (contestando el punto del filtro):** el Payment pertenece al
Run mediante `run_id` (N:1); el **ownership** se resuelve SIEMPRE por `run → campaign →
campaign.owner_user_id` en el lado servidor (nunca un `owner_user_id` en payment). La
acreditación del crédito va al run; la activación del run es un paso determinista del mismo
procesamiento, decidido en §6.

### 3.2 Tabla `payment_event` (lectura/write-only, auditoría + replay)

```
id                 uuid PK, defaultRandom
payment_id         uuid NOT NULL → payment_order(id) ON DELETE restrict
provider           text NOT NULL
provider_event_id  text NOT NULL
event_type         text NOT NULL        -- PAYMENT.CAPTURE.COMPLETED | PAYMENT.CAPTURE.REFUNDED |
                                        -- CHECKOUT.ORDER.APPROVED | CHECKOUT.ORDER.DENIED
processing_state   text NOT NULL        -- 'PROCESSED' | 'DUPLICATE_CAPTURE' | 'OUT_OF_ORDER' |
                                        -- 'REJECTED' | 'PENDING_RETRY'
failure_detail     text NULL            -- corto, sin datos del proveedor
payload            jsonb NOT NULL       -- raw del webhook, para auditoría (sin credenciales)
signature_verified boolean NOT NULL DEFAULT false
received_at timestamptz NOT NULL
processed_at timestamptz NULL
UNIQUE(provider, provider_event_id)     -- Nivel 1 de idempotencia
INDEX (payment_id)
```

### 3.3 Información del proveedor almacenada (punto explícito del filtro)

Para auditoría: order ID, capture ID, payload raw+verificado de firma, timestamps de
entrega/procesamiento, `event_type`. **Nunca**: credenciales de app, tokens de acceso, datos PII
del pagador más allá de lo necesario (email del payer en payload raw ya se guarda como artefacto
verificado — sin procesarlo).

---

## 4. State machine de la orden

```
                    +------------------+ (provisión user)
                    |  PENDING         |  ← creada por el owner con un amount + run
                    +--------+---------+
              approve (order) |           |  timeout del proveedor (24 h PayPal; configurable)
              v               |           v
     +------------+        +------------+
     |  APPROVED  |        | ABANDONED  |     ← no capturada dentro del lifetime del provider.
     +-----+------+        +------------+       ABANDONED es terminal para crédito.
           |
           | server-side capture (API retorno)  + webhook verificado CAPTURE.COMPLETED
           v
     +------------+  (refund verificado, futuro)
     |  CAPTURED  | ───────────────────────────→ REFUNDED   [fuera del alcance del Paso 10:
     +------------+                                          modelado, no implementado]
```

Transiciones aplicadas hasta ser idempotentes: `APPROVED` puede llegar por webhook
`CHECKOUT.ORDER.APPROVED`; el crédito SOLO en `CAPTURED` vía webhook `PAYMENT.CAPTURE.COMPLETED`
verificado. Eventos fuera de secuencia (p. ej. capture sin order aprobada en nuestra DB — posible
si el webhook de aprobación se perdió/retrasó): la máquina los **acepta si la orden existe y no
está ABANDONED** — el estado de la orden es nuestra fuente, no el orden de llegada; si la orden
no existe o está ABANDONED → evento marcado `OUT_OF_ORDER`/`REJECTED`, sin crédito, y queda
registrado para investigación.

---

## 5. Estrategia de idempotencia (los dos niveles, formulados)

```
Nivel 1 - EVENTO:   INSERTO payment_event(provider, provider_event_id).
                    Violación UNIQUE → el evento ya fue procesado → skip silencioso (retorno 200) / log.
Nivel 2 - CAPTURA:  dentro de la transacción del evento:
                      SELECT payment_order WHERE provider_capture_id = X FOR UPDATE;
                    si ya existe una orden con esa captura (y ya acreditada):
                      → evento actual se registra con processing_state='DUPLICATE_CAPTURE' (NUEVA fila,
                        distinto event_id), NO se acredita, status 200 (acknowledge de red).
                    si es la primera vez: → acreditación (ver §6) y estado CAPTURED.
```

Con la restricción UNIQUE de captura como **garantía de DB** de que jamás existirán dos órdenes
con la misma captura: si la transacción del nivel 2 fallara a mitad (crash), el evento ya está
insertado como `PENDING_RETRY` y se reprocesa; el credito o se hizo o no (transaccional). Nunca
doble.

**Replay:** copia del mismo event_id → nivel 1. **Fuera de orden:** §4. **Retries de PayPal:**
la misma red envía hasta ~10 veces; todos los caminos responden 200 solo después de que la
transacción determinó el resultado (acknowledge correcto). Si fallamos con 5xx (ej. nuestra BD),
PayPal reintenta — y nuestro `PENDING_RETRY`/estado lo hace seguro.

---

## 6. Acreditación y activación — atomicidad

Transacción única del manejador de `PAYMENT.CAPTURE.COMPLETED` (webhook verificada):

```
BEGIN
  1. insert/recoger payment_event (UNIQUE event)         — si ya existe: COMMIT (skip)
  2. SELECT payment_order (<-- provider_capture_id) FOR UPDATE   [captura primera vez?]
     Si captura ya acreditada (o UNIQUE violado): mark DUPLICATE_CAPTURE → COMMIT
  3. INSERT run_funding (run_id, cents, provider='paypal',
        provider_event_id = <capture_id>, verified=true, verified_at=now())   -- ledger
  4. UPDATE campaign_run SET credited_cents = credited_cents + amount
        (lock de la fila del run por el FOR UPDATE previo en el pago + FK);
  5. Si run.status = 'DRAFT' Y la campaña no tiene ACTIVE:
        UPDATE campaign_run SET status='ACTIVE', rate_anchor_at = floor(now())::ms
        (la guarda one-ACTIVE del índice parcial es el árbitro final: si viola la unicidad,
         la transacción revierte SOLO ese UPDATE: acreditación queda (pasos 3-4), activación
         no — el run queda DRAFT con fondos: el propietario activa (UI futura) o se cubre con
         el reintento de la tx al recibir el siguiente webhook? NO: el webhook ya consumió.
         Estrategia: si la activación falla por one-ACTIVE, el evento se marca
         'CAPTURED_NO_ACTIVATION' (estado extra para telemetría) y el DRAFT queda financiado.)
  6. UPDATE payment_order SET state='CAPTURED', provider_capture_id=X
  7. COMMIT
```

- **Browser return sin autoridad:** el retorno nunca toca el ledger. Solo una consulta
  server-side (`GET /api/paypal/orders/<id> por SDK`) puede confirmar estado para UX; el crédito
  sigue dependiendo del webhook verificado. Si el webhook tarda: la UI muestra "procesando"; el
  de re-fetch de estado (autorizado owner+server) nunca acredita por sí solo.
- **Verificación server-to-server:** firma del webhook validada por la llamada de verificación
  del SDK de PayPal (server-to-server con credenciales de app) ANTES de cualquier procesamiento;
  `signature_verified=true` se persiste en el evento. Nada se procesa sin verificación OK
  (evento se guarda REJECTED con detalle breve + se retorna 4xx para que no pase desapercibido).

---

## 7. Ownership

- Creación de orden/consulta/captura-por-retorno: SOLO el owner resuelto por `getAuthenticatedPrincipal`
  + owner-scope del run (mismo patrón `loadOwnedRunForFunding`). Sin `owner*` desde el cliente.
- Webhooks: autenticados por verificación de firma del proveedor (no es cookie ni token de
  sesión). El ownership del dinero se deriva del `payment_order.run_id` → campaign → owner.
- Un cliente **nunca** puede crear una orden para un run ajeno (colapso RUN_NOT_FOUND) ni leer
  eventos ajenos.

---

## 8. Análisis de carreras (escenarios §47 aplicados a pagos)

| # | Carrera | Mecanismo elegido |
|---|---|---|
| R1 | 2 webhooks, 2 event_ids, misma captura | UNIQUE captura + FOR UPDATE en nivel 2 → el 2º se marca DUPLICATE_CAPTURE, sin crédito |
| R2 | Retorno browser vs webhook | El retorno solo consulta (server-side GET informativo); nunca acredita; el webhook único |
| R3 | El run se agota (settlement) mientras el usuario estaba en PayPal | La captura acredita igualmente al run (recarga de un run EXHAUSTED: **decisión abierta §11** — no se inventa: documento registra dos caminos candidatos: refund o crédito-a-run-exhausted con política futura; **NO se decide aquí**) |
| R4 | Captura concurrente con activación de otro run (one-ACTIVE) | Índice parcial → la activación del evento falla → acreditación queda; estado `CAPTURED_NO_ACTIVATION`; run DRAFT fundado (activable) |
| R5 | 2 órdenes capturadas del mismo run en paralelo | Ambas acreditan (suma); activación idempotente/no-duplicada (solo DRAFT→ACTIVE una vez) |
| R6 | Mantenimiento de materialización EXHAUSTED mientras captura | Locks de ficha: la captura espera; luego chequea status DRAFT vs EXHAUSTED — decide por §8 R3 |
| R7 | Replay del mismo webhook | Nivel 1 (event UNIQUE) |

---

## 9. Amount y currency — validación técnica (SIN inventar política)

- **Representación:** entero seguro, `amount_cents > 0`; dominio exacto `≤ 2_501_999_793 cents`
  (techo matemático ADR-011 — no comercial: se hereda, no se propone).
- **Validación de concordancia:** el webhook debe reportar `amount == amount_cents` y
  `currency == 'USD'` con la orden; mismatch → evento `REJECTED` (detalle breve) + estado ORDER
  → `FAILED`... (FAILED no está en la máquina; se usa `ABANDONED`+evento REJECTED documentado).
- **Budget mínimo/máximo comercial: SIN DEFINIR.** La arquitectura acepta desde $0.01 hasta el
  techo técnico. La política comercial (mínimo/máximo, granularidad de top-up) queda
  **explícitamente abierta** a decisión de producto en la fase de UI/Live Market; el Paso 10 la
  exige solo como CONSTANTE CONFIGURABLE en un solo lugar (`domain-config`), tipo
  `FUNDING = { minCents, maxCents } | null` — `null` significa "sin límite comercial".

---

## 10. Invariantes (una fila de verdad)

I1. Toda fila de `run_funding` con `provider='paypal'` proviene de un webhook `CAPTURE.COMPLETED` verificado.
I2. Una captura acredita como máximo una vez (UNIQUE captura + nivel-2 tx).
I3. Un evento se procesa como máximo una vez (UNIQUE evento).
I4. El crédito nunca excede el techo exacto (`credited_cents ≤ 2_501_999_793`).
I5. La activación nunca ocurre sin crédito verificado (regla de 4D intacta).
I6. `rate_anchor_at` solo se escribe con `floor(now())` de PostgreSQL (ADR-013).
I7. El retorno del navegador nunca escribe el ledger.
I8. Sin webhook verificado → sin crédito (excepción: provider `internal` ADMIN-gated, test only).
I9. El estado de la orden nunca vuelve atrás (PENDING→APPROVED→CAPTURED→[REFUNDED]; ABANDONED terminal).
I10. `payment_event.payload` nunca contiene credenciales.
I11. Ownership: ninguna tabla financiera expone owner al cliente.
I12. En la acreditación y la activación dentro del webhook: si la activación no procede
      (no-DRAFT / one-ACTIVE), el crédito igual queda (nunca se pierde dinero), el estado de la
      orden marca solo el detalle de telemetría.
I13. La moneda es única (USD) hasta decisión de producto; nada se amplía implícitamente.

---

## 11. Decisiones abiertas que NO se inventan aquí (marcadas explicitamente para producto/posterior)

- **Budget mínimo / máximo / granularidad** (comercial).
- **Reembolsos** (REFUNDED modelo solo — out of scope Paso 10).
- **Recarga de run EXHAUSTED** (§R3): refund automático vs crédito al run agotado (¿y un rewrite de
  "Run Again con fondos"? Fuera: decisión posterior, previa al Live Market real).
- **Expiración de ABANDONED**: el valor provider (24 h PayPal) como límite técnico; el negocio
  (avísame por email, cuántos intentos) se define con producto.
- **UI**: checkout, botones, copy — fuera hasta después de que esta revisión se apruebe.
- **Múltiples DRAFT y activación automática** (¿cuál desarrollo activar si hay 2 DRAFT?): el
  modelo activa el run de la orden; la ambigüedad de elegir entre varios DRAFT es decisión de
  producto (multiplicidad DRAFT sigue abierta §12 master), no se resuelve aquí.

---

## 12. Cambios de schema propuestos (resumen numérico)

- `0006` (una sola migración, generada con drizzle-kit, auditada §40):
  1. `payment_order` (run_fk restrict, checks amount/currency/state, 2 unique parciales)
  2. `payment_event` (payment_fk restrict, UNIQUE(provider, provider_event_id), payload jsonb)
- Sin cambios en `campaign_run`, `run_funding` (solo nuevos valores de `provider`), `campaign`.
- Hashes 0000-0004 intactos; `drizzle-kit generate` seguirá confirmando nothing-to-migrate
  hasta que se toque el schema.

---

## 13. Plan de implementación Paso 10 (planificado — NO ejecutado)

1. **Schema**: aplicar §12 (migración 0006 + inspect + hashes + journal).
2. **Capas de dominio** (`src/modules/payments/paypal/`): máquina de estados de órdenes (pura,
   DI), validador de eventos (pura), políticas de idempotencia (puras), sin SDK.
3. **Capa de servicio** (`src/lib/paypal-*`): verificación de firma (SDK `paypal-checkout-server-sdk`,
   solo server), webhook handler con la tx §6, acciones de orden (create/capture) owner-scoped.
4. **Routes**: `/api/paypal/webhook` (POST, verificado, sin sesión), endpoints de orden (con
   sesión, owner).
5. **Tests**: unit (state machine; idempotencia niveles 1-2; R1-R7 abstractas con fakes),
   structural (schema), contract runtime: sandbox con dos credentials — MANUAL ACTION del
   usuario (crear app sandbox + webhook URL pública + credenciales como secrets Vercel).
6. **Gates**: test/typecheck/lint/build + migración aplicada a dev.
7. **Parada para auditoría** antes de enrutar producción; Sandbox solo con confirmación.

---

## 14. Qué queda sin verificar hasta el Paso 10

- Ninguna llamada real al SDK de PayPal (por diseño de fase).
- La verificación de firma real (requiere credenciales sandbox — acción manual del usuario).
- El runtime con un webhook real de PayPal.
- La decisión de la UI (fuera de estas fases).
