from __future__ import annotations

import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright

LOGIN_URL = os.getenv('OHOU_LOGIN_URL', 'https://o2o-partner.ohou.se/moving/payment/cash')
OUT_PATH = Path(os.getenv('OHOU_AUTH_OUT', 'ohou_storage_state.json')).resolve()


def main() -> None:
    print(f'[INFO] login url: {LOGIN_URL}')
    print(f'[INFO] output: {OUT_PATH}')
    print('[INFO] visible Chromium will open. Log in to 오늘의집 파트너센터 manually if needed.')
    print('[INFO] After login completes and the payment/cash page is visible, return here and press Enter.')
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()
        page.goto(LOGIN_URL, wait_until='domcontentloaded')
        input()
        state = context.storage_state()
        OUT_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding='utf-8')
        print(f'[OK] saved auth state to {OUT_PATH}')
        browser.close()


if __name__ == '__main__':
    main()
