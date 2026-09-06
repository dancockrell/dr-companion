# Read-only comparison against a pinned historical archive. Never overwrite
# room descriptions, current topology, or asset approvals with these matches.
$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path $PSScriptRoot -Parent
$revision = '8fd4d49d90ce2af33c1b358fb7f95eb406b1fd16'
$url = "https://raw.githubusercontent.com/Sarvatt/dr-mapdb/$revision/map.xml"
$raw = (Invoke-WebRequest $url).Content
$xml = [System.Xml.XmlDocument]::new()
$xml.XmlResolver = $null
$xml.LoadXml($raw)
$batch = Get-Content (Join-Path $repositoryRoot 'data/world/crossing-city-batch.json') -Raw | ConvertFrom-Json
$byId = @{}
$byTitle = @{}
$localRooms = @{}
foreach ($room in $batch.rooms) { $localRooms[$room.id] = $room }
function Title-Key([string]$value) { return $value.Trim('[',']').Trim().ToLowerInvariant() }
foreach ($room in $xml.map.room) {
  $byId[[string]$room.id] = $room
  foreach ($title in @($room.title)) {
    $key = Title-Key ([string]$title)
    if (-not $byTitle.ContainsKey($key)) { $byTitle[$key] = [System.Collections.Generic.List[object]]::new() }
    if (-not $byTitle[$key].Contains($room)) { $byTitle[$key].Add($room) }
  }
}
$results = @(
  foreach ($room in $batch.rooms | Where-Object { -not $_.description }) {
    $key = Title-Key $room.title
    $candidates = @(
      if ($byTitle.ContainsKey($key)) {
        foreach ($candidate in $byTitle[$key]) {
          $matched = 0
          $neighbors = 0
          $comparisons = @(
            foreach ($exit in $room.connections) {
              $archiveExits = @($candidate.exit | Where-Object { $_.type -eq 'String' -and $_.InnerText.Trim() -eq $exit.command })
              $commandMatched = $archiveExits.Count -gt 0
              $neighborMatched = $false
              if ($commandMatched) { $matched++ }
              $localTarget = if ($exit.targetCellId -and $localRooms.ContainsKey($exit.targetCellId)) { $localRooms[$exit.targetCellId] } else { $null }
              foreach ($archiveExit in $archiveExits) {
                $target = $byId[[string]$archiveExit.target]
                if ($localTarget -and $target) {
                  foreach ($title in @($target.title)) {
                    if ((Title-Key ([string]$title)) -eq (Title-Key $localTarget.title)) { $neighborMatched = $true }
                  }
                }
              }
              if ($neighborMatched) { $neighbors++ }
              [ordered]@{ command=$exit.command; commandMatched=$commandMatched; targetTitleMatched=$neighborMatched }
            }
          )
          $descriptions = @($candidate.description | ForEach-Object { [string]$_ })
          $descriptionBytes = [System.Text.Encoding]::UTF8.GetBytes(($descriptions -join "`n"))
          $descriptionHash = [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($descriptionBytes)).ToLowerInvariant()
          [ordered]@{
            archiveRoomId=[string]$candidate.id
            commandMatches=$matched
            neighborTitleMatches=$neighbors
            requestedExits=@($room.connections).Count
            archiveExitCount=@($candidate.exit).Count
            descriptionVariants=$descriptions.Count
            descriptionSha256=$descriptionHash
            comparisons=$comparisons
          }
        }
      }
    ) | Sort-Object -Property @{Expression={$_.neighborTitleMatches};Descending=$true}, @{Expression={$_.commandMatches};Descending=$true}, archiveRoomId
    $candidates = @($candidates)
    $best = if ($candidates.Count) { $candidates[0] } else { $null }
    $uniqueBest = $best -and ($candidates.Count -eq 1 -or
      $best.neighborTitleMatches -gt $candidates[1].neighborTitleMatches -or
      ($best.neighborTitleMatches -eq $candidates[1].neighborTitleMatches -and $best.commandMatches -gt $candidates[1].commandMatches))
    $completeMatch = $uniqueBest -and $best.requestedExits -gt 0 -and $best.neighborTitleMatches -eq $best.requestedExits
    [ordered]@{
      cellId=$room.id; title=$room.title
      status= if ($completeMatch) {'historical-neighborhood-match-needs-review'} elseif ($best) {'ambiguous-or-partial-needs-review'} else {'no-title-match'}
      candidates=$candidates
    }
  }
)
$output = [ordered]@{
  schemaVersion=1
  source=[ordered]@{repository='https://github.com/Sarvatt/dr-mapdb';revision=$revision;commitDate='2020-06-17';url=$url}
  policy='Historical research candidates only. Different room-ID namespace. No imported prose, no current-state claim, no asset admission, no topology replacement.'
  counts=[ordered]@{
    missingRooms=$results.Count
    historicalNeighborhoodMatches=@($results | Where-Object {$_.status -eq 'historical-neighborhood-match-needs-review'}).Count
    partialOrAmbiguous=@($results | Where-Object {$_.status -eq 'ambiguous-or-partial-needs-review'}).Count
    noTitleMatch=@($results | Where-Object {$_.status -eq 'no-title-match'}).Count
  }
  rooms=$results
}
$destination = Join-Path $repositoryRoot 'data/world/crossing-archive-candidates.json'
[System.IO.File]::WriteAllText($destination, ($output | ConvertTo-Json -Depth 16) + "`n", [System.Text.UTF8Encoding]::new($false))
$output.counts | ConvertTo-Json -Compress
