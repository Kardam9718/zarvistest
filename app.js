/* Zarvis — local-first business forensics. No API, no uploads, no account. */

const STORAGE_KEY = "zarvis-v1";
const CURRENCY_KEY = "zarvis-currency";
const currencySymbols = { INR: "₹", USD: "$", GBP: "£", EUR: "€" };

const emptyState = () => ({
  businessName: "My business",
  currency: localStorage.getItem(CURRENCY_KEY) || "INR",
  openingCash: 0,
  transactions: [],
  inventory: [],
  production: [],
  sales: []
});

let state = loadState();
let activeView = "overview";
let toastTimer;

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved ? { ...emptyState(), ...saved } : emptyState();
  } catch {
    return emptyState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  localStorage.setItem(CURRENCY_KEY, state.currency);
}

function money(value, compact = false) {
  const n = Number(value) || 0;
  const symbol = currencySymbols[state.currency] || state.currency + " ";
  if (compact && Math.abs(n) >= 1000000) return `${symbol}${(n / 1000000).toFixed(1)}M`;
  if (compact && Math.abs(n) >= 100000) return `${symbol}${(n / 100000).toFixed(1)}L`;
  if (compact && Math.abs(n) >= 1000) return `${symbol}${(n / 1000).toFixed(1)}k`;
  return `${symbol}${Math.round(n).toLocaleString("en-IN")}`;
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[char]));
}

function uid(prefix = "id") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function parseDate(date) {
  return date ? new Date(`${date}T12:00:00`) : new Date();
}

function formatDate(date) {
  if (!date) return "—";
  return parseDate(date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function sum(list, fn) {
  return list.reduce((total, item) => total + number(fn(item)), 0);
}

function typeLabel(type) {
  return ({ income: "Income", expense: "Expense", capital: "Capital", loan: "Loan",
    asset: "Asset", draw: "Owner draw", purchase: "Purchase", consumption: "Used",
    waste: "Waste", adjustment_in: "Stock in", adjustment_out: "Stock out" }[type] || type);
}

function transactionInflow(t) {
  return ["income", "capital", "loan"].includes(t.type) ? number(t.amount) : 0;
}

function transactionOutflow(t) {
  return ["expense", "asset", "draw"].includes(t.type) ? number(t.amount) : 0;
}

function operationalExpenses() {
  return sum(state.transactions.filter(t => ["expense", "asset", "draw"].includes(t.type)), t => t.amount);
}

function totals() {
  const inflow = sum(state.transactions, transactionInflow);
  const outflow = sum(state.transactions, transactionOutflow);
  const cash = number(state.openingCash) + inflow - outflow;
  const revenue = sum(state.sales, s => s.qty * s.unitPrice);
  const receivedSales = sum(state.sales, s => s.received);
  const receivables = Math.max(0, revenue - receivedSales);
  const productionCosts = sum(state.production, p => number(p.materialCost) + number(p.laborCost) + number(p.overheadCost));
  const goodUnits = sum(state.production, p => p.goodUnits);
  const avgProductionCost = goodUnits ? productionCosts / goodUnits : 0;
  const cogs = sum(state.sales, s => number(s.qty) * productUnitCost(s.product));
  const profit = revenue - cogs - operationalExpenses();
  const inventory = inventorySummary();
  const inventoryValue = sum(Object.values(inventory), i => i.qty * i.avgCost);
  const unreconciled = sum(state.transactions.filter(t => !t.category || t.category.toLowerCase() === "uncategorized"), t => Math.max(transactionInflow(t), transactionOutflow(t)));
  return { inflow, outflow, cash, revenue, receivedSales, receivables, productionCosts, goodUnits, avgProductionCost, cogs, profit, inventoryValue, unreconciled };
}

function inventorySummary() {
  const map = {};
  for (const row of state.inventory) {
    const item = (row.item || "Unnamed item").trim();
    if (!map[item]) map[item] = { item, qty: 0, purchased: 0, purchaseValue: 0, wasted: 0, used: 0 };
    const r = map[item];
    const qty = number(row.qty);
    if (row.type === "purchase" || row.type === "adjustment_in") {
      r.qty += qty; r.purchased += qty;
      if (row.type === "purchase") r.purchaseValue += qty * number(row.unitCost);
    } else if (row.type === "consumption") {
      r.qty -= qty; r.used += qty;
    } else if (row.type === "waste" || row.type === "adjustment_out") {
      r.qty -= qty; if (row.type === "waste") r.wasted += qty;
    }
    r.qty = Math.max(0, r.qty);
  }
  Object.values(map).forEach(r => { r.avgCost = r.purchased ? r.purchaseValue / r.purchased : 0; });
  return map;
}

function productUnitCost(product) {
  const rows = state.production.filter(p => String(p.product).toLowerCase() === String(product).toLowerCase());
  const good = sum(rows, r => r.goodUnits);
  const costs = sum(rows, r => number(r.materialCost) + number(r.laborCost) + number(r.overheadCost));
  return good ? costs / good : 0;
}

function productSummary() {
  const products = {};
  state.production.forEach(p => {
    const key = p.product || "Unnamed product";
    if (!products[key]) products[key] = { product: key, good: 0, rejected: 0, cost: 0, sold: 0, revenue: 0 };
    products[key].good += number(p.goodUnits);
    products[key].rejected += number(p.rejectedUnits);
    products[key].cost += number(p.materialCost) + number(p.laborCost) + number(p.overheadCost);
  });
  state.sales.forEach(s => {
    const key = s.product || "Unnamed product";
    if (!products[key]) products[key] = { product: key, good: 0, rejected: 0, cost: 0, sold: 0, revenue: 0 };
    products[key].sold += number(s.qty);
    products[key].revenue += number(s.qty) * number(s.unitPrice);
  });
  return Object.values(products).map(p => {
    p.unitCost = p.good ? p.cost / p.good : 0;
    p.margin = p.revenue - p.sold * p.unitCost;
    p.wastageRate = p.good + p.rejected ? p.rejected / (p.good + p.rejected) : 0;
    return p;
  }).sort((a, b) => a.margin - b.margin);
}

function monthlySummary() {
  const months = {};
  const keyFor = date => date ? date.slice(0, 7) : "Undated";
  state.transactions.forEach(t => {
    const k = keyFor(t.date); if (!months[k]) months[k] = { key: k, income: 0, outflow: 0 };
    months[k].income += transactionInflow(t); months[k].outflow += transactionOutflow(t);
  });
  state.sales.forEach(s => {
    const k = keyFor(s.date); if (!months[k]) months[k] = { key: k, income: 0, outflow: 0 };
    months[k].sales = (months[k].sales || 0) + number(s.qty) * number(s.unitPrice);
  });
  return Object.values(months).filter(m => m.key !== "Undated").sort((a, b) => a.key.localeCompare(b.key)).slice(-8);
}

function findings() {
  const t = totals();
  const list = [];
  const products = productSummary();
  const inventory = inventorySummary();
  const risky = products.filter(p => p.sold && p.unitCost && p.revenue / p.sold < p.unitCost).sort((a, b) => b.sold * b.unitCost - a.sold * a.unitCost);
  if (risky.length) {
    const p = risky[0];
    list.push({ tone: "red", icon: "↘", title: `${p.product} is selling below its true cost`, detail: `${p.sold} units sold at ${money(p.revenue / p.sold)} average vs ${money(p.unitCost)} cost per unit.`, amount: p.sold * (p.unitCost - p.revenue / p.sold) });
  }
  if (t.receivables > 0) {
    list.push({ tone: "orange", icon: "!", title: `${money(t.receivables)} is still with customers`, detail: "Sales have been recorded, but the matching cash has not arrived yet.", amount: t.receivables });
  }
  const stocked = Object.values(inventory).filter(i => i.qty > 0).sort((a, b) => b.qty * b.avgCost - a.qty * a.avgCost);
  if (stocked.length && t.inventoryValue > 0) {
    const top = stocked[0];
    list.push({ tone: "blue", icon: "□", title: `${top.item} is holding the most cash in stock`, detail: `${top.qty.toFixed(1)} units remain at an estimated ${money(top.qty * top.avgCost)} value.`, amount: top.qty * top.avgCost });
  }
  const wastage = sum(state.production, p => number(p.rejectedUnits));
  if (wastage > 0) {
    const totalUnits = sum(state.production, p => number(p.goodUnits) + number(p.rejectedUnits));
    const rate = totalUnits ? wastage / totalUnits : 0;
    list.push({ tone: rate > 0.08 ? "red" : "orange", icon: "△", title: `${wastage} production units were rejected`, detail: `Observed rejection rate is ${(rate * 100).toFixed(1)}% across entered batches.`, amount: null });
  }
  if (t.unreconciled > 0) {
    list.push({ tone: "orange", icon: "?", title: `${money(t.unreconciled)} needs classification`, detail: "Uncategorised movements make the loss explanation less reliable.", amount: t.unreconciled });
  }
  if (!list.length) {
    list.push({ tone: "blue", icon: "✓", title: "Add transactions to start the autopsy", detail: "Zarvis will rank the biggest cash, stock and margin risks once data is entered.", amount: null });
  }
  return list.slice(0, 5);
}

function render() {
  document.getElementById("app").innerHTML = `
    <div class="app-shell">
      ${topbar()}
      <div class="layout">
        ${sidebar()}
        <main class="main">${viewContent()}</main>
      </div>
      ${modalHost()}
      ${toastHost()}
    </div>`;
  bindEvents();
}

function topbar() {
  return `<header class="topbar">
    <div class="brand">
      <div class="brand-mark">Z</div>
      <div class="brand-name">Zarvis</div>
      <div class="brand-sub">Business forensics</div>
    </div>
    <div class="top-actions">
      <div class="privacy-badge"><span class="privacy-dot"></span> Data stays on this device</div>
      <button class="button" data-action="export-json">Backup</button>
      <button class="button primary" data-action="open-modal" data-modal="transaction">Add entry</button>
    </div>
  </header>`;
}

function sidebar() {
  const nav = [
    ["overview", "◒", "Overview"],
    ["ledger", "≡", "Money trail"],
    ["inventory", "□", "Inventory"],
    ["production", "△", "Production"],
    ["sales", "↗", "Sales"],
    ["diagnostics", "⌁", "Loss autopsy"]
  ];
  return `<aside class="sidebar">
    <div class="business-card">
      <div class="eyebrow">Current workspace</div>
      <div class="business-name">${escapeHtml(state.businessName)}</div>
      <button class="button small" style="margin-top:12px;width:100%" data-action="business-settings">Edit business</button>
    </div>
    <div class="nav-label">Navigate</div>
    <nav class="nav">${nav.map(([id, icon, label]) => `<button class="${activeView === id ? "active" : ""}" data-view="${id}"><span class="nav-icon">${icon}</span>${label}</button>`).join("")}</nav>
    <div class="sidebar-bottom">
      <div class="eyebrow">Local workspace</div>
      <p>No account. No uploads. Export a backup before changing devices.</p>
    </div>
  </aside>`;
}

function viewContent() {
  if (activeView === "ledger") return ledgerView();
  if (activeView === "inventory") return inventoryView();
  if (activeView === "production") return productionView();
  if (activeView === "sales") return salesView();
  if (activeView === "diagnostics") return diagnosticsView();
  return overviewView();
}

function pageHead(kicker, title, desc, actions = "") {
  return `<div class="page-head"><div><div class="eyebrow">${kicker}</div><h1>${title}</h1><p>${desc}</p></div><div class="page-actions">${actions}</div></div>`;
}

function overviewView() {
  const t = totals();
  const actions = `<button class="button" data-action="load-demo">Load sample case</button><button class="button primary" data-action="open-modal" data-modal="transaction">＋ Add transaction</button>`;
  return `${pageHead("Business snapshot", "Know where the money went.", "A private, local-first view of cash, stock, margin and the reasons behind a loss.", actions)}
    <div class="metric-grid">
      ${metric("Cash available", money(t.cash, true), t.cash < 0 ? "negative" : "positive", "Opening cash + money in − money out")}
      ${metric("Operating result", money(t.profit, true), t.profit < 0 ? "negative" : "positive", "Sales − cost of goods − expenses")}
      ${metric("Cash in stock", money(t.inventoryValue, true), "warning", "Estimated from purchase cost")}
      ${metric("With customers", money(t.receivables, true), t.receivables ? "warning" : "positive", "Recorded sales not yet collected")}
    </div>
    <div class="grid-2">
      <div>
        ${lossHero(t)}
        <div class="section-spacer"></div>
        ${trendPanel()}
      </div>
      <div>
        ${findingsPanel()}
        <div class="section-spacer"></div>
        ${businessHealthPanel(t)}
      </div>
    </div>
    <div class="section-spacer"></div>${productPanel()}`;
}

function metric(label, value, tone, foot) {
  return `<div class="metric"><div class="metric-label">${label}<span class="muted">↗</span></div><div class="metric-value ${tone}">${value}</div><div class="metric-foot">${foot}</div></div>`;
}

function lossHero(t) {
  const loss = Math.max(0, -t.profit);
  return `<section class="loss-hero"><div class="eyebrow">Loss autopsy</div><h2>${loss ? "Something is leaking." : "No operating loss detected."}</h2><p>${loss ? "Zarvis will separate cash movement, inventory and true operating result so a cash gap does not get mistaken for the whole story." : "Keep entering sales, costs and production batches. Zarvis will flag the first meaningful variance."}</p><div class="hero-number ${loss ? "" : "ok"}">${loss ? `${money(loss)} estimated operating loss` : "The picture is currently healthy"}</div></section>`;
}

function findingsPanel() {
  return `<section class="panel"><div class="panel-header"><div><div class="panel-title">What needs attention</div><div class="panel-sub">Ranked from the data you have entered</div></div><button class="button small" data-view="diagnostics">View all</button></div><div class="panel-body"><div class="finding-list">${findings().map(f => `<div class="finding"><div class="finding-icon ${f.tone}">${f.icon}</div><div><div class="finding-title">${escapeHtml(f.title)}</div><div class="finding-detail">${escapeHtml(f.detail)}</div></div><div class="finding-amount">${f.amount != null ? money(f.amount, true) : "—"}</div></div>`).join("")}</div></div></section>`;
}

function trendPanel() {
  const rows = monthlySummary();
  const max = Math.max(1, ...rows.flatMap(r => [r.income, r.outflow]));
  return `<section class="panel"><div class="panel-header"><div><div class="panel-title">Money movement</div><div class="panel-sub">Last ${rows.length || 0} entered months</div></div><div class="legend"><span><i style="background:#78b0f3"></i>In</span><span><i style="background:#f0a18f"></i>Out</span></div></div><div class="panel-body">${rows.length ? `<div class="trend">${rows.map(r => `<div class="trend-col"><div class="trend-bars"><div class="trend-bar in" title="In ${money(r.income)}" style="height:${Math.max(2, r.income / max * 100)}%"></div><div class="trend-bar out" title="Out ${money(r.outflow)}" style="height:${Math.max(2, r.outflow / max * 100)}%"></div></div><div class="trend-month">${r.key.slice(5)}</div></div>`).join("")}</div>` : `<div class="empty"><strong>Your monthly story will appear here</strong><p>Add a few dated entries to see inflows and outflows together.</p></div>`}</div></section>`;
}

function businessHealthPanel(t) {
  const confidence = dataConfidence();
  return `<section class="panel"><div class="panel-header"><div><div class="panel-title">Business health</div><div class="panel-sub">A clear number needs complete evidence</div></div><span class="pill ${confidence >= 70 ? "capital" : "waste"}">${confidence}% confidence</span></div><div class="panel-body"><div class="kpi-line"><span>Money trail entries</span><strong>${state.transactions.length}</strong></div><div class="kpi-line"><span>Sales records</span><strong>${state.sales.length}</strong></div><div class="kpi-line"><span>Production batches</span><strong>${state.production.length}</strong></div><div class="kpi-line"><span>Unreconciled value</span><strong class="${t.unreconciled ? "negative" : "positive"}">${money(t.unreconciled, true)}</strong></div></div></section>`;
}

function productPanel() {
  const rows = productSummary();
  return `<section class="panel"><div class="panel-header"><div><div class="panel-title">Product economics</div><div class="panel-sub">Know which products create margin and which quietly destroy it</div></div><button class="button small" data-action="open-modal" data-modal="production">＋ Add batch</button></div>${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Product</th><th>Good units</th><th>True unit cost</th><th>Avg sale price</th><th>Margin</th><th>Waste</th></tr></thead><tbody>${rows.map(p => `<tr><td><strong>${escapeHtml(p.product)}</strong></td><td>${p.good.toLocaleString("en-IN")}</td><td>${p.unitCost ? money(p.unitCost) : "—"}</td><td>${p.sold ? money(p.revenue / p.sold) : "—"}</td><td class="amount ${p.margin < 0 ? "negative" : "positive"}">${p.sold ? money(p.margin) : "—"}</td><td>${(p.wastageRate * 100).toFixed(1)}%</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty"><strong>No product economics yet</strong><p>Add a production batch and sales entry to calculate true unit cost.</p></div>`}</section>`;
}

function ledgerView() {
  const rows = [...state.transactions].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return `${pageHead("Money trail", "Every movement, accounted for.", "Record income, costs, capital and drawings. Zarvis keeps cash movement separate from operating profit.", `<button class="button" data-action="import-csv">Import CSV</button><button class="button primary" data-action="open-modal" data-modal="transaction">＋ Add transaction</button>`)}
    <section class="panel"><div class="panel-header"><div><div class="panel-title">Transaction ledger</div><div class="panel-sub">${rows.length} entries stored locally on this device</div></div><button class="button small" data-action="export-csv" data-export="transactions">Export CSV</button></div>${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Party</th><th>Category</th><th class="right">Amount</th><th></th></tr></thead><tbody>${rows.map(t => `<tr><td>${formatDate(t.date)}</td><td><span class="pill ${t.type}">${typeLabel(t.type)}</span></td><td><strong>${escapeHtml(t.description || "Untitled")}</strong></td><td>${escapeHtml(t.party || "—")}</td><td>${escapeHtml(t.category || "Uncategorised")}</td><td class="right amount ${transactionInflow(t) ? "positive" : "negative"}">${transactionInflow(t) ? "+" : "−"}${money(t.amount)}</td><td><button class="button small danger" data-action="delete" data-collection="transactions" data-id="${t.id}">Delete</button></td></tr>`).join("")}</tbody></table></div>` : emptyBlock("No money trail yet", "Start with capital, a few expenses and any customer receipts. Manual entry is built in.", "transaction")}</section>`;
}

function inventoryView() {
  const rows = [...state.inventory].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const summary = Object.values(inventorySummary()).sort((a, b) => b.qty * b.avgCost - a.qty * a.avgCost);
  return `${pageHead("Inventory", "See cash sitting on the shelf.", "Track purchases, consumption, wastage and adjustments. Stock value is estimated from landed purchase cost.", `<button class="button" data-action="import-csv">Import CSV</button><button class="button primary" data-action="open-modal" data-modal="inventory">＋ Add stock movement</button>`)}
    <div class="grid-3">${summary.slice(0, 3).map(i => `<section class="panel"><div class="panel-body"><div class="eyebrow">${escapeHtml(i.item)}</div><div class="metric-value warning">${i.qty.toFixed(1)}</div><div class="metric-foot">units on hand · ${money(i.qty * i.avgCost)} estimated value</div></div></section>`).join("") || `<section class="panel" style="grid-column:1/-1">${emptyBlock("No stock movements yet", "Add purchases and consumption to understand where cash is locked.")}</section>`}</div>
    <div class="section-spacer"></div><section class="panel"><div class="panel-header"><div><div class="panel-title">Stock movement log</div><div class="panel-sub">${rows.length} movements</div></div></div>${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Item</th><th>Movement</th><th>Qty</th><th>Unit cost</th><th>Party</th><th></th></tr></thead><tbody>${rows.map(r => `<tr><td>${formatDate(r.date)}</td><td><strong>${escapeHtml(r.item)}</strong></td><td><span class="pill ${r.type}">${typeLabel(r.type)}</span></td><td>${number(r.qty).toLocaleString("en-IN")}</td><td>${r.unitCost ? money(r.unitCost) : "—"}</td><td>${escapeHtml(r.party || "—")}</td><td><button class="button small danger" data-action="delete" data-collection="inventory" data-id="${r.id}">Delete</button></td></tr>`).join("")}</tbody></table></div>` : ""}</section>`;
}

function productionView() {
  const rows = [...state.production].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return `${pageHead("Production", "Cost the good unit—not the guess.", "Enter batches with material, labour, overhead and rejects. Zarvis computes cost per saleable unit.", `<button class="button primary" data-action="open-modal" data-modal="production">＋ Add batch</button>`)}
    <section class="panel"><div class="panel-header"><div><div class="panel-title">Production batches</div><div class="panel-sub">${rows.length} batches</div></div></div>${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Batch</th><th>Product</th><th>Good</th><th>Rejected</th><th>Total cost</th><th>Cost / good unit</th><th></th></tr></thead><tbody>${rows.map(p => { const cost = number(p.materialCost)+number(p.laborCost)+number(p.overheadCost); return `<tr><td>${formatDate(p.date)}</td><td>${escapeHtml(p.batch || "—")}</td><td><strong>${escapeHtml(p.product)}</strong></td><td>${number(p.goodUnits)}</td><td class="${number(p.rejectedUnits) ? "negative" : ""}">${number(p.rejectedUnits)}</td><td>${money(cost)}</td><td class="amount">${p.goodUnits ? money(cost / p.goodUnits) : "—"}</td><td><button class="button small danger" data-action="delete" data-collection="production" data-id="${p.id}">Delete</button></td></tr>`; }).join("")}</tbody></table></div>` : emptyBlock("No production batches yet", "For helmets, enter good units and rejects separately. This is where hidden wastage becomes visible.", "production")}</section>`;
}

function salesView() {
  const rows = [...state.sales].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return `${pageHead("Sales & receivables", "Revenue is not the same as cash.", "Record what was sold and what was actually collected. Zarvis keeps the difference visible.", `<button class="button primary" data-action="open-modal" data-modal="sale">＋ Add sale</button>`)}
    <section class="panel"><div class="panel-header"><div><div class="panel-title">Sales register</div><div class="panel-sub">${rows.length} sales records · ${money(sum(rows, r => r.qty*r.unitPrice))} billed</div></div></div>${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Customer</th><th>Product</th><th>Qty</th><th>Sales value</th><th>Received</th><th>Balance</th><th></th></tr></thead><tbody>${rows.map(s => { const total=number(s.qty)*number(s.unitPrice); const due=Math.max(0,total-number(s.received)); return `<tr><td>${formatDate(s.date)}</td><td>${escapeHtml(s.customer || "—")}</td><td><strong>${escapeHtml(s.product)}</strong></td><td>${number(s.qty)}</td><td>${money(total)}</td><td class="positive">${money(s.received)}</td><td class="${due ? "negative" : "positive"}">${money(due)}</td><td><button class="button small danger" data-action="delete" data-collection="sales" data-id="${s.id}">Delete</button></td></tr>`; }).join("")}</tbody></table></div>` : emptyBlock("No sales yet", "Enter invoices or dispatches even if the customer has not paid. That gap is often where the story hides.", "sale")}</section>`;
}

function diagnosticsView() {
  const t = totals();
  const products = productSummary();
  return `${pageHead("Loss autopsy", "Explain the loss, not just the number.", "Zarvis ranks the most likely loss drivers and shows what evidence is still missing.", `<button class="button" data-action="business-settings">Set opening cash</button><button class="button primary" data-action="open-modal" data-modal="transaction">＋ Add evidence</button>`)}
    <div class="grid-2"><section class="panel"><div class="panel-header"><div><div class="panel-title">Ranked findings</div><div class="panel-sub">Based only on the records you have entered</div></div></div><div class="panel-body"><div class="finding-list">${findings().map(f => `<div class="finding"><div class="finding-icon ${f.tone}">${f.icon}</div><div><div class="finding-title">${escapeHtml(f.title)}</div><div class="finding-detail">${escapeHtml(f.detail)}</div></div><div class="finding-amount">${f.amount != null ? money(f.amount, true) : "—"}</div></div>`).join("")}</div></div></section>
    <section class="panel"><div class="panel-header"><div><div class="panel-title">Reconciliation</div><div class="panel-sub">Three views of the same business</div></div></div><div class="panel-body"><div class="kpi-line"><span>Cash available</span><strong>${money(t.cash)}</strong></div><div class="kpi-line"><span>Operating result</span><strong class="${t.profit < 0 ? "negative" : "positive"}">${money(t.profit)}</strong></div><div class="kpi-line"><span>Inventory value</span><strong>${money(t.inventoryValue)}</strong></div><div class="kpi-line"><span>Receivables</span><strong>${money(t.receivables)}</strong></div><div class="kpi-line"><span>Unreconciled value</span><strong class="${t.unreconciled ? "negative" : "positive"}">${money(t.unreconciled)}</strong></div><div class="callout" style="margin-top:16px">A cash gap is not automatically a business loss. Stock, receivables, capital, loans and owner withdrawals must be separated first.</div></div></section></div>
    <div class="section-spacer"></div><section class="panel"><div class="panel-header"><div><div class="panel-title">Missing evidence checklist</div><div class="panel-sub">Add these to make the diagnosis sharper</div></div></div><div class="panel-body">${checklist()}</div></section>
    <div class="section-spacer"></div>${productPanel()}`;
}

function checklist() {
  const checks = [
    ["Opening cash and closing bank balance", state.openingCash > 0 && state.transactions.length > 0],
    ["Sales register with customer and collection status", state.sales.length > 0],
    ["Purchases and stock movements", state.inventory.length > 0],
    ["Production batches with rejected units", state.production.length > 0],
    ["Owner withdrawals and partner capital", state.transactions.some(t => ["draw", "capital"].includes(t.type))],
    ["Expenses categorised with a party", state.transactions.some(t => t.type === "expense" && t.category && t.party)]
  ];
  return `<div style="display:grid;gap:10px">${checks.map(([label, ok]) => `<div class="checkbox-row"><span style="color:${ok ? "var(--green)" : "var(--orange)"};font-weight:800">${ok ? "✓" : "○"}</span>${label}<span class="muted" style="margin-left:auto">${ok ? "Captured" : "Missing"}</span></div>`).join("")}</div>`;
}

function emptyBlock(title, text, modal = null) {
  return `<div class="empty"><strong>${title}</strong><p>${text}</p>${modal ? `<button class="button primary" data-action="open-modal" data-modal="${modal}">Add manually</button>` : ""}</div>`;
}

function modalHost() { return `<div id="modal-root"></div>`; }
function toastHost() { return `<div id="toast-root"></div>`; }

function showToast(message) {
  clearTimeout(toastTimer);
  const root = document.getElementById("toast-root");
  if (!root) return;
  root.innerHTML = `<div class="toast">${escapeHtml(message)}</div>`;
  toastTimer = setTimeout(() => { root.innerHTML = ""; }, 2800);
}

function dataConfidence() {
  let score = 0;
  if (state.openingCash > 0) score += 15;
  if (state.transactions.length >= 5) score += 20;
  if (state.sales.length >= 3) score += 20;
  if (state.inventory.length >= 3) score += 20;
  if (state.production.length >= 1) score += 15;
  if (state.transactions.length && state.transactions.every(t => t.category && t.party)) score += 10;
  return Math.min(score, 100);
}

function openModal(name) {
  const root = document.getElementById("modal-root");
  if (!root) return;
  root.innerHTML = `<div class="modal-backdrop" data-action="close-modal"><div class="modal" role="dialog" aria-modal="true" onclick="event.stopPropagation()">${modalContent(name)}</div></div>`;
  root.querySelector(".modal-backdrop").addEventListener("click", e => { if (e.target.dataset.action === "close-modal") closeModal(); });
  root.querySelectorAll("[data-action='close-modal']").forEach(btn => btn.addEventListener("click", closeModal));
}

function closeModal() { const root = document.getElementById("modal-root"); if (root) root.innerHTML = ""; }

function modalShell(title, sub, body) {
  return `<div class="modal-header"><div><h2>${title}</h2><p>${sub}</p></div><button class="icon-button" data-action="close-modal" aria-label="Close">×</button></div><div class="modal-body">${body}</div>`;
}

function modalContent(name) {
  if (name === "transaction") return modalShell("Add money movement", "Manual entry is the fastest way to start. All data stays on this device.", `<form data-form="transaction"><div class="form-grid">
    ${field("Date", "date", "date", today(), true)}${field("Movement", "type", "select", "", true, [["income","Customer receipt / income"],["expense","Expense / supplier payment"],["capital","Partner capital"],["loan","Loan received"],["asset","Asset or machinery"],["draw","Owner withdrawal"]])}
    ${field("Description", "description", "text", "", true)}${field("Amount", "amount", "number", "", true, null, "0.00")}
    ${field("Party", "party", "text", "", false, null, "Supplier, customer or partner")}${field("Category", "category", "text", "", false, null, "Raw material, rent, transport…")}
    ${field("Notes", "notes", "textarea", "", true, null, "Optional context or reference")}
    </div><div class="form-actions"><button type="button" class="button" data-action="close-modal">Cancel</button><button class="button primary">Save movement</button></div></form>`);
  if (name === "inventory") return modalShell("Add stock movement", "Track what came in, was used, wasted or adjusted.", `<form data-form="inventory"><div class="form-grid">
    ${field("Date", "date", "date", today(), true)}${field("Movement", "type", "select", "", true, [["purchase","Purchase received"],["consumption","Used in production"],["waste","Wastage / rejection"],["adjustment_in","Stock adjustment in"],["adjustment_out","Stock adjustment out"]])}
    ${field("Item", "item", "text", "", true, null, "Shell, strap, padding…")}${field("Quantity", "qty", "number", "", true, null, "0")}
    ${field("Unit cost", "unitCost", "number", "", false, null, "Required for purchases")}${field("Party", "party", "text", "", false, null, "Supplier or batch")}
    </div><div class="form-actions"><button type="button" class="button" data-action="close-modal">Cancel</button><button class="button primary">Save stock movement</button></div></form>`);
  if (name === "production") return modalShell("Add production batch", "Enter good output and rejects separately. This is the heart of unit economics.", `<form data-form="production"><div class="form-grid">
    ${field("Date", "date", "date", today(), true)}${field("Batch ID", "batch", "text", "", false, null, "e.g. B-001")}
    ${field("Product", "product", "text", "", true, null, "Helmet H-100")}${field("Good units", "goodUnits", "number", "", true, null, "Saleable output")}
    ${field("Rejected units", "rejectedUnits", "number", "0", false, null, "Scrap / rework")}${field("Material cost", "materialCost", "number", "", true)}
    ${field("Direct labour", "laborCost", "number", "0", false)}${field("Overhead", "overheadCost", "number", "0", false)}
    ${field("Notes", "notes", "textarea", "", true, null, "Reason for variance, machine issue…")}
    </div><div class="form-actions"><button type="button" class="button" data-action="close-modal">Cancel</button><button class="button primary">Save batch</button></div></form>`);
  if (name === "sale") return modalShell("Add sale", "Record what was sold and what has actually been collected.", `<form data-form="sale"><div class="form-grid">
    ${field("Date", "date", "date", today(), true)}${field("Customer", "customer", "text", "", false)}
    ${field("Product", "product", "text", "", true, null, "Helmet H-100")}${field("Quantity", "qty", "number", "", true)}
    ${field("Unit sale price", "unitPrice", "number", "", true)}${field("Amount received", "received", "number", "0", false)}
    ${field("Notes", "notes", "textarea", "", true, null, "Invoice, credit terms…")}
    </div><div class="form-actions"><button type="button" class="button" data-action="close-modal">Cancel</button><button class="button primary">Save sale</button></div></form>`);
  return modalShell("Business settings", "A few details make the reconciliation more useful.", `<form data-form="settings"><div class="form-grid">
    ${field("Business name", "businessName", "text", state.businessName, true)}${field("Currency", "currency", "select", state.currency, true, [["INR","Indian rupee (₹)"],["USD","US dollar ($)"],["GBP","British pound (£)"],["EUR","Euro (€)"]])}
    ${field("Opening cash", "openingCash", "number", state.openingCash, true, null, "Cash + bank at start of tracking")}
    </div><div class="callout" style="margin-top:15px">This is a local workspace. Your data is saved only in this browser. Use Backup before clearing browser data.</div><div class="form-actions"><button type="button" class="button" data-action="close-modal">Cancel</button><button class="button primary">Save settings</button></div></form>`);
}

function field(label, name, type, value = "", required = false, options = null, placeholder = "") {
  if (type === "select") return `<div class="field"><label for="field-${name}">${label}${required ? " *" : ""}</label><select id="field-${name}" name="${name}" ${required ? "required" : ""}>${(options || []).map(([v, l]) => `<option value="${v}" ${String(v) === String(value) ? "selected" : ""}>${l}</option>`).join("")}</select></div>`;
  if (type === "textarea") return `<div class="field full"><label for="field-${name}">${label}${required ? " *" : ""}</label><textarea id="field-${name}" name="${name}" ${required ? "required" : ""} placeholder="${escapeHtml(placeholder)}">${escapeHtml(value)}</textarea></div>`;
  return `<div class="field"><label for="field-${name}">${label}${required ? " *" : ""}</label><input id="field-${name}" name="${name}" type="${type}" value="${escapeHtml(value)}" ${required ? "required" : ""} placeholder="${escapeHtml(placeholder)}" /></div>`;
}

function formObject(form) {
  const fd = new FormData(form);
  return Object.fromEntries(fd.entries());
}

function bindEvents() {
  document.querySelectorAll("[data-view]").forEach(btn => btn.addEventListener("click", () => { activeView = btn.dataset.view; render(); }));
  document.querySelectorAll("[data-action='open-modal']").forEach(btn => btn.addEventListener("click", () => openModal(btn.dataset.modal)));
  document.querySelectorAll("[data-action='close-modal']").forEach(btn => btn.addEventListener("click", closeModal));
  document.querySelectorAll("[data-action='business-settings']").forEach(btn => btn.addEventListener("click", () => openModal("settings")));
  document.querySelectorAll("[data-action='export-json']").forEach(btn => btn.addEventListener("click", exportJson));
  document.querySelectorAll("[data-action='export-csv']").forEach(btn => btn.addEventListener("click", () => exportCollection(btn.dataset.export)));
  document.querySelectorAll("[data-action='load-demo']").forEach(btn => btn.addEventListener("click", loadDemo));
  document.querySelectorAll("[data-action='import-csv']").forEach(btn => btn.addEventListener("click", importCsv));
  document.querySelectorAll("[data-action='delete']").forEach(btn => btn.addEventListener("click", () => deleteRow(btn.dataset.collection, btn.dataset.id)));
  document.querySelectorAll("[data-form]").forEach(form => form.addEventListener("submit", handleForm));
}

function handleForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = formObject(form);
  if (form.dataset.form === "settings") {
    state.businessName = data.businessName || "My business";
    state.currency = data.currency || "INR";
    state.openingCash = number(data.openingCash);
    saveState(); closeModal(); render(); showToast("Business settings saved");
    return;
  }
  if (form.dataset.form === "transaction") state.transactions.push({ ...data, id: uid("txn"), amount: number(data.amount) });
  if (form.dataset.form === "inventory") state.inventory.push({ ...data, id: uid("inv"), qty: number(data.qty), unitCost: number(data.unitCost) });
  if (form.dataset.form === "production") state.production.push({ ...data, id: uid("batch"), goodUnits: number(data.goodUnits), rejectedUnits: number(data.rejectedUnits), materialCost: number(data.materialCost), laborCost: number(data.laborCost), overheadCost: number(data.overheadCost) });
  if (form.dataset.form === "sale") state.sales.push({ ...data, id: uid("sale"), qty: number(data.qty), unitPrice: number(data.unitPrice), received: number(data.received) });
  saveState(); closeModal(); render(); showToast("Saved locally");
}

function deleteRow(collection, id) {
  if (!confirm("Delete this entry?")) return;
  state[collection] = state[collection].filter(row => row.id !== id);
  saveState(); render(); showToast("Entry deleted");
}

function exportJson() {
  download("zarvis-backup.json", JSON.stringify(state, null, 2), "application/json");
  showToast("Backup downloaded");
}

function exportCollection(collection) {
  const rows = state[collection] || [];
  if (!rows.length) return showToast("Nothing to export yet");
  const keys = [...new Set(rows.flatMap(r => Object.keys(r)))];
  const csv = [keys.join(","), ...rows.map(row => keys.map(k => csvCell(row[k])).join(","))].join("\n");
  download(`zarvis-${collection}.csv`, csv, "text/csv");
  showToast("CSV exported");
}

function csvCell(value) {
  const str = value == null ? "" : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function download(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function importCsv() {
  const input = document.createElement("input");
  input.type = "file"; input.accept = ".csv,text/csv";
  input.onchange = () => {
    const file = input.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => parseCsv(String(reader.result || ""));
    reader.readAsText(file);
  };
  input.click();
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return showToast("CSV needs a header row and at least one data row");
  const headers = splitCsvLine(lines[0]).map(x => x.trim().toLowerCase().replace(/\s+/g, ""));
  const rows = lines.slice(1).map(line => {
    const cells = splitCsvLine(line); const obj = {};
    headers.forEach((h, i) => obj[h] = cells[i] || "");
    return obj;
  });
  const dateKey = headers.find(h => ["date", "transactiondate", "entrydate"].includes(h));
  const amountKey = headers.find(h => ["amount", "value", "total"].includes(h));
  const descKey = headers.find(h => ["description", "details", "narration", "particulars"].includes(h));
  if (!dateKey || !amountKey) return showToast("CSV needs date and amount columns");
  rows.forEach(r => {
    const raw = number(String(r[amountKey]).replace(/[^0-9.-]/g, ""));
    const description = r[descKey] || "Imported entry";
    const sign = String(r.type || r.transactiontype || "").toLowerCase().includes("credit") ? "income" : (raw >= 0 ? "expense" : "income");
    state.transactions.push({ id: uid("csv"), date: r[dateKey], type: sign, description, amount: Math.abs(raw), party: r.party || r.vendor || r.customer || "", category: r.category || "", notes: "Imported from CSV" });
  });
  saveState(); render(); showToast(`${rows.length} entries imported locally`);
}

function splitCsvLine(line) {
  const out = []; let cur = ""; let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && line[i + 1] === '"' && quoted) { cur += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (c === "," && !quoted) { out.push(cur.trim()); cur = ""; }
    else cur += c;
  }
  out.push(cur.trim()); return out;
}

function loadDemo() {
  if (state.transactions.length && !confirm("Replace current local data with a sample helmet case?")) return;
  state = demoState(); saveState(); activeView = "overview"; render(); showToast("Sample case loaded");
}

function demoState() {
  const s = emptyState();
  s.businessName = "Northline Helmets";
  s.openingCash = 356000;
  const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];
  const tx = [];
  tx.push({ id: uid("txn"), date: "2026-01-02", type: "capital", description: "Partner capital", amount: 356000, party: "New partner", category: "Capital", notes: "" });
  const out = [420000, 490000, 510000, 560000, 530000, 600000, 590000, 620000];
  const inc = [390000, 450000, 480000, 430000, 530000, 470000, 520000, 730000];
  months.forEach((m, i) => {
    tx.push({ id: uid("txn"), date: `${m}-05`, type: "income", description: "Customer receipts", amount: inc[i], party: i % 2 ? "Dealer network" : "Retail parties", category: "Sales", notes: "" });
    tx.push({ id: uid("txn"), date: `${m}-12`, type: "expense", description: "Materials and suppliers", amount: out[i] * 0.62, party: "Supplier network", category: "Raw material", notes: "" });
    tx.push({ id: uid("txn"), date: `${m}-20`, type: "expense", description: "Payroll, rent and logistics", amount: out[i] * 0.38, party: "Operations", category: i === 5 ? "" : "Operations", notes: "" });
  });
  s.transactions = tx;
  s.inventory = [
    { id: uid("inv"), date: "2026-01-08", type: "purchase", item: "ABS shell", qty: 1200, unitCost: 210, party: "Shell supplier" },
    { id: uid("inv"), date: "2026-02-08", type: "purchase", item: "Strap", qty: 1300, unitCost: 34, party: "Parts supplier" },
    { id: uid("inv"), date: "2026-05-10", type: "consumption", item: "ABS shell", qty: 840, unitCost: 210, party: "Batch production" },
    { id: uid("inv"), date: "2026-06-12", type: "waste", item: "ABS shell", qty: 92, unitCost: 210, party: "Batch B-006" },
    { id: uid("inv"), date: "2026-07-18", type: "purchase", item: "Visor", qty: 1000, unitCost: 82, party: "Visor supplier" }
  ];
  s.production = [
    { id: uid("batch"), date: "2026-02-15", batch: "B-001", product: "H-100 Helmet", goodUnits: 320, rejectedUnits: 11, materialCost: 88000, laborCost: 21000, overheadCost: 13000, notes: "" },
    { id: uid("batch"), date: "2026-04-15", batch: "B-002", product: "H-100 Helmet", goodUnits: 280, rejectedUnits: 19, materialCost: 82000, laborCost: 20500, overheadCost: 14000, notes: "" },
    { id: uid("batch"), date: "2026-06-15", batch: "B-003", product: "H-100 Helmet", goodUnits: 240, rejectedUnits: 38, materialCost: 79000, laborCost: 22000, overheadCost: 15000, notes: "High rejection month" }
  ];
  s.sales = [
    { id: uid("sale"), date: "2026-02-28", customer: "Dealer A", product: "H-100 Helmet", qty: 250, unitPrice: 330, received: 70000, notes: "" },
    { id: uid("sale"), date: "2026-04-30", customer: "Dealer B", product: "H-100 Helmet", qty: 220, unitPrice: 320, received: 70400, notes: "" },
    { id: uid("sale"), date: "2026-07-30", customer: "Dealer C", product: "H-100 Helmet", qty: 190, unitPrice: 310, received: 30000, notes: "Large outstanding balance" }
  ];
  return s;
}

render();