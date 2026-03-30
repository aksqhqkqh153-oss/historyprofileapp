$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\icj24\Downloads\historyprofile_app"
if (!(Test-Path '.git')) {
  git init
}
git branch -M main
git remote remove origin 2>$null
 git remote add origin https://github.com/aksqhqkqh153-oss/historyprofile_app.git
 git add .
 git commit -m "chore: initial deployment-ready historyprofile_app project" 2>$null
 git push -u origin main
