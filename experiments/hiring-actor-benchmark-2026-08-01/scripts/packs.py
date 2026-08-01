PACKS = {
 "A_sales_ops": ["sales operations manager","sales operations lead","head of sales operations","director of sales operations"],
 "B_revenue_ops": ["revenue operations manager","revenue operations lead","head of revenue operations","director of revenue operations"],
 "C_gtm_ops": ["gtm operations manager","gtm operations lead","head of gtm operations","director of gtm operations"],
}
# Loose family match: the ops DISCIPLINE plus a seniority word. Deliberately
# wider than the exact pack so recall is measured, not assumed.
FAMILY = {
 "A_sales_ops": ["sales operations","sales ops"],
 "B_revenue_ops": ["revenue operations","revenue ops","revops"],
 "C_gtm_ops": ["gtm operations","gtm ops","go-to-market operations"],
}
def match(title):
    t = (title or "").lower()
    exact = [p for p,ts in PACKS.items() if any(x == t.strip() for x in ts)]
    fam   = [p for p,ks in FAMILY.items() if any(k in t for k in ks)]
    return exact, fam
