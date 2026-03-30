import csv
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / 'backend' / 'data' / 'app.db'
OUT_PATH = ROOT / 'db_admin' / 'users_export.csv'

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row
rows = conn.execute("SELECT id, email, nickname, role, region, phone, recovery_email, created_at FROM users ORDER BY id").fetchall()

with OUT_PATH.open('w', newline='', encoding='utf-8-sig') as f:
    writer = csv.writer(f)
    writer.writerow(['id', 'email', 'nickname', 'role', 'region', 'phone', 'recovery_email', 'created_at'])
    for row in rows:
        writer.writerow([row['id'], row['email'], row['nickname'], row['role'], row['region'], row['phone'], row['recovery_email'], row['created_at']])

print(f'exported -> {OUT_PATH}')
