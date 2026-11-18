#!/usr/bin/env python3
"""把 chat/js/miniapps/ddz-rules.js 原样复制成 Edge Function 能打包的 rules.gen.js。

Edge Function 只会打包 supabase/functions 下被 import 的文件，读不到 chat/ 目录。
ddz-rules.js 是唯一的真相来源（浏览器和服务器共用），这个脚本只在前面加一行「自动生成」的头。

  python3 supabase/functions/ddz/gen-rules.py          重新生成
  python3 supabase/functions/ddz/gen-rules.py --check  只检查已提交的 rules.gen.js 是不是最新（CI 用）
"""
import pathlib
import sys

root = pathlib.Path(__file__).resolve().parent.parent.parent.parent
src = root / "chat" / "js" / "miniapps" / "ddz-rules.js"
dst = root / "supabase" / "functions" / "ddz" / "rules.gen.js"
out = (
    "// 自动生成，不要手改：来源 chat/js/miniapps/ddz-rules.js，由 supabase/functions/ddz/gen-rules.py 生成\n"
    + src.read_text(encoding="utf-8")
)
if "--check" in sys.argv:
    if not dst.exists() or dst.read_text(encoding="utf-8") != out:
        sys.exit(f"::error::{dst.name} 和 {src.name} 不一致，请重新生成")
    print(f"{dst.name} is up to date")
else:
    dst.write_text(out, encoding="utf-8")
    print("wrote", dst.relative_to(root))
