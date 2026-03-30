#!/bin/bash
set -e
cd "$(dirname "$0")"
npm install
npm run init:ios
npm run sync:ios
npm run open:ios
