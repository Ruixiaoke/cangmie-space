#!/usr/bin/env python3
"""把 agent/persona.md 生成成 Edge Function 能打包的 TypeScript 模块。

Edge Function 只会打包 supabase/functions 下被 import 的文件，读不到仓库里的 agent/persona.md。
所以：persona.md 是唯一的真相来源，这个脚本把它原样（不改一个字）写进
supabase/functions/agent-chat/persona.gen.ts。

  python3 agent/gen-persona.py          重新生成（backend.yml 部署前会跑一遍）
  python3 agent/gen-persona.py --check  只检查已提交的 persona.gen.ts 是不是最新（CI 用）
"""
import json
import pathlib
import sys

root = pathlib.Path(__file__).resolve().parent.parent
for name in ("persona", "ye-ying", "xie-yunliu", "li-wangsheng", "tang-wuying"):
    src = root / "agent" / f"{name}.md"
    dst = root / "supabase" / "functions" / "agent-chat" / f"{name}.gen.ts"
    text = src.read_text(encoding="utf-8")
    out = (
        f"// 自动生成，不要手改：来源 agent/{name}.md，由 agent/gen-persona.py 生成\n"
        "export const PERSONA: string = " + json.dumps(text, ensure_ascii=False) + ";\n"
    )
    if "--check" in sys.argv:
        if not dst.exists() or dst.read_text(encoding="utf-8") != out:
            sys.exit(f"::error::{dst.name} 和 {src.name} 不一致，请重新生成")
        print(f"{dst.name} is up to date")
    else:
        dst.write_text(out, encoding="utf-8")
        print("wrote", dst.relative_to(root))
