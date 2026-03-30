from __future__ import annotations

import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright

LOGIN_URL = os.getenv("SOOMGO_LOGIN_URL", "https://soomgo.com/login")
OUT_PATH = Path(os.getenv("SOOMGO_AUTH_OUT", "soomgo_storage_state.json")).resolve()


def main() -> None:
    print(f"[INFO] login url: {LOGIN_URL}")
    print(f"[INFO] output: {OUT_PATH}")
    print("[INFO] visible Chromium will open. Log in to Soomgo manually, including captcha/additional verification if prompted.")
    print("[INFO] After login completes and the login page disappears, return here and press Enter.")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()
        page.goto(LOGIN_URL, wait_until="domcontentloaded")
        input()
        state = context.storage_state()
        OUT_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[OK] saved auth state to {OUT_PATH}")
        browser.close()


if __name__ == "__main__":
    main()
