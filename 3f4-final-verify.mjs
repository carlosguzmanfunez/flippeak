import { Pool } from "@neondatabase/serverless";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const campaignId = "ff05c09a-2221-4bcd-a7ef-8ca9e93b6a51";

let failures = 0;

function check(number, label, ok, actual, expected) {
  const result = ok ? "PASS" : "FAIL";

  console.log(
    `${number}. ${result} | ${label} | actual=${String(actual)} | esperado=${String(expected)}`
  );

  if (!ok) failures++;
}

try {
  const campaignResult = await pool.query(
    `
    SELECT
      c.id,
      c.title,
      c.summary,
      c.destination_url,
      c.category,
      c.subtype,
      c.owner_user_id,
      u.email AS owner_email
    FROM campaign c
    JOIN "user" u
      ON u.id = c.owner_user_id
    WHERE c.id = $1
    `,
    [campaignId]
  );

  const runResult = await pool.query(
    `
    SELECT
      id,
      campaign_id,
      previous_run_id,
      status,
      time_rate_cents_per_hour,
      credited_cents,
      consumed_cent_ms,
      rate_anchor_at,
      title,
      summary,
      destination_url,
      category,
      subtype,
      created_at
    FROM campaign_run
    WHERE campaign_id = $1
    ORDER BY created_at DESC
    `,
    [campaignId]
  );

  const totals = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM campaign_run) AS total_runs,
      (SELECT count(*)::int FROM campaign) AS total_campaigns
  `);

  const migrations = await pool.query(`
    SELECT count(*)::int AS migration_count
    FROM drizzle.__drizzle_migrations
  `);

  const campaign = campaignResult.rows[0];
  const run = runResult.rows[0];

  console.log("");
  console.log("=== 3F-4 — 11 COMPROBACIONES FINALES ===");
  console.log("");

  check(
    1,
    "Existe exactamente un run para la campaña",
    runResult.rowCount === 1,
    runResult.rowCount,
    1
  );

  check(
    2,
    "status",
    run?.status === "DRAFT",
    run?.status,
    "DRAFT"
  );

  check(
    3,
    "time_rate_cents_per_hour",
    run?.time_rate_cents_per_hour === 10100,
    run?.time_rate_cents_per_hour,
    10100
  );

  check(
    4,
    "campaign_id coincide",
    run?.campaign_id === campaignId,
    run?.campaign_id,
    campaignId
  );

  check(
    5,
    "previous_run_id IS NULL",
    run?.previous_run_id === null,
    run?.previous_run_id,
    null
  );

  check(
    6,
    "snapshot title",
    run?.title === campaign?.title,
    run?.title,
    campaign?.title
  );

  check(
    7,
    "snapshot summary",
    run?.summary === campaign?.summary,
    run?.summary,
    campaign?.summary
  );

  check(
    8,
    "snapshot destination_url canonical",
    run?.destination_url === campaign?.destination_url &&
      run?.destination_url === "https://example.com/",
    run?.destination_url,
    "https://example.com/"
  );

  check(
    9,
    "snapshot category",
    run?.category === campaign?.category,
    run?.category,
    campaign?.category
  );

  check(
    10,
    "snapshot subtype",
    run?.subtype === campaign?.subtype,
    run?.subtype,
    campaign?.subtype
  );

  const accountingOk =
    String(run?.credited_cents) === "0" &&
    String(run?.consumed_cent_ms) === "0" &&
    run?.rate_anchor_at === null;

  check(
    11,
    "estado contable DRAFT",
    accountingOk,
    `${run?.credited_cents} / ${run?.consumed_cent_ms} / ${run?.rate_anchor_at}`,
    "0 / 0 / null"
  );

  console.log("");
  console.log("=== EVIDENCIA ADICIONAL DE SOLO LECTURA ===");
  console.log(`Run id: ${run?.id}`);
  console.log(`Title: ${run?.title}`);
  console.log(`Summary: ${run?.summary}`);
  console.log(`Destination URL: ${run?.destination_url}`);
  console.log(`Category: ${run?.category}`);
  console.log(`Subtype: ${run?.subtype}`);
  console.log(`Total campaign_run: ${totals.rows[0].total_runs}`);
  console.log(`Total campaign: ${totals.rows[0].total_campaigns}`);
  console.log(`Migraciones registradas: ${migrations.rows[0].migration_count}`);
  console.log(`Propietario: ${campaign?.owner_email}`);

  const supplementalOk =
    totals.rows[0].total_runs === 1 &&
    totals.rows[0].total_campaigns === 1 &&
    migrations.rows[0].migration_count === 5 &&
    campaign?.owner_email === "flippeak.test@example.com";

  console.log("");

  if (failures === 0 && supplementalOk) {
    console.log("RESULTADO_FINAL: 11/11 PASS");
    console.log("EVIDENCIA_ADICIONAL: PASS");
    console.log("3F_LISTO_PARA_CIERRE");
  } else {
    console.log(`RESULTADO_FINAL: ${11 - failures}/11 PASS`);
    console.log(
      `EVIDENCIA_ADICIONAL: ${supplementalOk ? "PASS" : "FAIL"}`
    );
    console.log("NO_CERRAR_3F");
    process.exitCode = 1;
  }
} catch (error) {
  console.error("VERIFICACION_ABORTADA:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
