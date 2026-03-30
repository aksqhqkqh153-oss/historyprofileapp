$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\icj24\Downloads\historyprofile_app\frontend"
npm install
npm run build
Write-Host 'Build complete. Upload this folder to Cloudflare Pages Direct Upload if needed:'
Write-Host 'C:\Users\icj24\Downloads\historyprofile_app\frontend\dist'
