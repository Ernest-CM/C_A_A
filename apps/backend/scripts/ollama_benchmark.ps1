param(
  [string]$Model = "gemma3:1b",
  [string]$Url = "http://127.0.0.1:11434",
  [int]$NumPredict = 128,
  [string]$KeepAlive = "10m"
)

$ErrorActionPreference = "Stop"

function ToSeconds([object]$ns) {
  if ($null -eq $ns) { return $null }
  # Ollama durations are nanoseconds
  return [Math]::Round(([double]$ns) / 1e9, 3)
}

Write-Host "Model: $Model"
Write-Host "URL:   $Url"
Write-Host "KeepAlive: $KeepAlive"
Write-Host "Stopping model (best-effort) to force cold load..."
try { ollama stop $Model | Out-Null } catch { }

$body = @{
  model = $Model
  prompt = 'Return ONLY JSON: {"ok": true, "message": "hello"}'
  stream = $false
  keep_alive = $KeepAlive
  options = @{ temperature = 0; num_predict = $NumPredict }
} | ConvertTo-Json -Depth 10

function Invoke-OllamaOnce([string]$Label) {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $resp = Invoke-RestMethod -Uri "$Url/api/generate" -Method Post -ContentType "application/json" -Body $body
  $sw.Stop()

  $total = ToSeconds $resp.total_duration
  $load = ToSeconds $resp.load_duration
  $promptEval = ToSeconds $resp.prompt_eval_duration
  $eval = ToSeconds $resp.eval_duration

  [pscustomobject]@{
    run = $Label
    wall_s = [Math]::Round($sw.Elapsed.TotalSeconds, 3)
    total_s = $total
    load_s = $load
    prompt_eval_s = $promptEval
    eval_s = $eval
    prompt_tokens = $resp.prompt_eval_count
    output_tokens = $resp.eval_count
  }
}

$r1 = Invoke-OllamaOnce "cold"
$r2 = Invoke-OllamaOnce "warm"

Write-Host "\nResults (seconds):"
@($r1, $r2) | Format-Table -AutoSize

Write-Host "\nTip: In another terminal run:  nvidia-smi -l 1"
Write-Host "You should see GPU utilization change during generation."
