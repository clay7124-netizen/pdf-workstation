"""Synthetic tests for strict local edit gating. All files stay in job temp dir."""
from __future__ import annotations
import json
import tempfile
from pathlib import Path
from proof import make_latin, make_chinese_cid, ensure_chinese_static_font, use_simple_font_tounicode_experiment
from strict_adapter import strict_preflight, strict_apply

def run():
    use_simple_font_tounicode_experiment()
    cases=[]
    with tempfile.TemporaryDirectory() as temp:
        p=Path(temp)
        latin=p/"source-latin.pdf"; make_latin(latin)
        chinese=p/"source-cjk.pdf"; make_chinese_cid(chinese)

        checks=[
          ("latin_same_length",latin,"2024","2025",True,"EDITED"),
          ("cjk_same_length",chinese,"正常","異常",True,"EDITED"),
          ("cjk_existing_glyphs",chinese,"維修","日期",True,"EDITED"),
          ("cjk_longer_text",chinese,"正常","正常正常",False,"DIFFERENT_GLYPH_COUNT"),
          ("cjk_shorter_text",chinese,"正常","常",False,"DIFFERENT_GLYPH_COUNT"),
          ("cjk_missing_glyph",chinese,"正常","風險",False,"ORIGINAL_FONT_MISSING_GLYPHS"),
          ("delete_word",chinese,"正常","",False,"DELETION_NOT_READY"),
          ("ambiguous_word",chinese,"年","月",False,"AMBIGUOUS_OR_UNREADABLE_TEXT"),
        ]
        for case,source,old,new,should_pass,reason in checks:
            out=p/(case+".pdf")
            preflight=strict_preflight(source,old,new)
            result=strict_apply(source,out,old,new)
            passed=(result.allowed == should_pass
                    and (reason==result.code)
                    and (out.is_file()==should_pass))
            cases.append({
                "case":case,"pass":passed,"preflight":preflight.as_dict(),
                "apply":result.as_dict(),
            })
        existing=p/"already.pdf"; existing.write_bytes(b"DO NOT OVERWRITE")
        block=strict_apply(latin,existing,"2024","2025")
        cases.append({"case":"existing_output_protection",
                      "pass":block.code=="OUTPUT_EXISTS" and existing.read_bytes()==b"DO NOT OVERWRITE",
                      "apply":block.as_dict()})
        source_copy=latin.read_bytes()
        block=strict_apply(latin,latin,"2024","2025")
        cases.append({"case":"source_protection",
                      "pass":block.code=="OVERWRITE_FORBIDDEN" and latin.read_bytes()==source_copy,
                      "apply":block.as_dict()})
    report={"all_pass":all(x["pass"] for x in cases),"cases":cases}
    Path("poc/original-text-edit/results/strict_policy_report.json").write_text(
        json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    for case in cases:
        print(("PASS" if case["pass"] else "FAIL")+" "+case["case"]+
              " -> "+case["apply"]["code"])
    if not report["all_pass"]:
        raise SystemExit(1)

if __name__=="__main__":
    run()
