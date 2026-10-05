$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$node = (Get-Command node.exe -ErrorAction Stop).Source
$qaScript = Join-Path $repoRoot "apps\api\dist\scripts\qaModels.js"
if (-not (Test-Path $qaScript)) {
  throw "Build the API first: npm run build -w @prompt-playground/api"
}

$taskName = "ARIP-OpenRouter-Free-Model-Health"
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$qaScript`"" -WorkingDirectory $repoRoot
$trigger = New-ScheduledTaskTrigger -Daily -At "6:00 AM"
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 45) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $taskName -Description "Check the configured OpenRouter free models and refresh the ARIP model health catalog." -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Output "Registered $taskName to run daily at 6:00 AM for $env:USERDOMAIN\$env:USERNAME."
Write-Output "Run it now with: Start-ScheduledTask -TaskName $taskName"
