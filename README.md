# Zarvis

Zarvis is a local-first business forensics tool for understanding:

- where money came from and where it went;
- how much cash is tied up in inventory;
- what customers still owe;
- true unit economics for a product;
- the most likely reasons for an operating loss.

## Run locally

```bash
cd zarvis
python3 -m http.server 4173
```

Open `http://localhost:4173`.

## Deploy on Cloudflare Pages

Upload the `zarvis` folder as a static site. No server, API key, database or paid service is required for the MVP.

## Data model

The tool stores data in the browser's local storage. It supports:

- manual money movements;
- CSV import for a basic transaction ledger;
- inventory purchases, consumption and wastage;
- production batches with good and rejected units;
- sales and receivables;
- JSON backup/restore and CSV exports.

Use **Backup** before clearing browser data or moving to another device.

## Important

This MVP is an analysis aid, not statutory accounting or tax advice. Its confidence score is intentionally reduced when evidence is missing. It should not claim a definitive loss reason until cash, sales, inventory and production records are reconciled.