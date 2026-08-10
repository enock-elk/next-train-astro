from pathlib import Path
base = Path(r"C:\Users\enock\OneDrive\Documents\GitHub\Metrorail Next Train\Source Code")
ob = (base / "southern_outbound.tsv").read_text(encoding="utf-8")
ib = (base / "southern_inbound.tsv").read_text(encoding="utf-8")

def esc(s: str) -> str:
    return s.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")

js = (
    "(async () => {\n"
    f"  const outbound = `{esc(ob)}`;\n"
    f"  const inbound = `{esc(ib)}`;\n"
    "  window.__timetable = { outbound, inbound };\n"
    "  await navigator.clipboard.writeText(outbound);\n"
    "  return { ok: true, outboundLen: outbound.length, inboundLen: inbound.length };\n"
    "})()\n"
)
(base / "southern_paste.js").write_text(js, encoding="utf-8")
print("js chars", len(js))
