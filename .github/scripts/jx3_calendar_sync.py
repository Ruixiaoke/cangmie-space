#!/usr/bin/env python3
"""从 JX3API（第三方，非官方）抓今天起 7 天的剑三日常，写进 Supabase 的 public.jx3_calendar。

由 .github/workflows/jx3-calendar.yml 定时运行。数据库连接串来自环境变量 SUPABASE_DB_URL（仓库 secret，不回显）。
JX3API 服务器在大陆，从海外访问慢且常超时：每天每次请求最多试 4 次，单次 25 秒。
某天抓不到就跳过（库里留着上次的），全部失败才让任务失败。
"""
import json
import os
import sys
import time
import urllib.request

import psycopg

BASE = "https://www.jx3api.com/active/calendar"
DAYS = 7
TRIES = 4


def fetch(num):
    last = None
    for i in range(TRIES):
        try:
            req = urllib.request.Request(f"{BASE}?num={num}", headers={"Accept": "application/json", "User-Agent": "cangmie-chat-agent"})
            with urllib.request.urlopen(req, timeout=25) as r:
                body = json.load(r)
            if body.get("status") != 200 or not isinstance(body.get("detail"), dict) or not body["detail"].get("date"):
                raise ValueError(f"bad response status={body.get('status')}")
            return body["detail"]
        except Exception as e:  # noqa: BLE001 网络错误、超时、格式不对都重试
            last = e
            time.sleep(3 * (i + 1))
    print(f"::warning::day +{num}: {type(last).__name__}: {last}")
    return None


def main():
    url = os.environ.get("SUPABASE_DB_URL")
    if not url:
        sys.exit("::error::缺少 SUPABASE_DB_URL")
    rows = []
    for n in range(DAYS):
        d = fetch(n)
        if d:
            rows.append((d["date"], json.dumps(d, ensure_ascii=False)))
            print(f"day +{n}: {d['date']} ok")
    if not rows:
        sys.exit("::error::一天的日常都没抓到")
    with psycopg.connect(url, prepare_threshold=None) as conn:
        with conn.cursor() as cur:
            for date, data in rows:
                cur.execute(
                    "insert into public.jx3_calendar (date, data, fetched_at) values (%s, %s::jsonb, now()) "
                    "on conflict (date) do update set data = excluded.data, fetched_at = now()",
                    (date, data),
                )
            cur.execute("delete from public.jx3_calendar where date < current_date - 14")
    print(f"saved {len(rows)} day(s)")


if __name__ == "__main__":
    main()
