# Automatisk deploy (venter på tillatelse)

`deploy.yml.txt` er en ferdig GitHub Actions-workflow som
bygger og deployer siden ved hver push til main. Den kunne ikke pushes fordi
gh-tokenet mangler `workflow`-tillatelse.

For å ta den i bruk:

1. Kjør `gh auth refresh -s workflow`
2. Flytt fila til `.github/workflows/deploy.yml` og push
3. Sett Pages-kilden til "GitHub Actions" under Settings → Pages

Inntil da deployes siden ved å bygge lokalt og pushe `out/` til
`gh-pages`-grenen (se README).
