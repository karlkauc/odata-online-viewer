# odata-viewer.status20.net – lokale Testinstanz

Docker-Container auf dem status20-Host, vom Host-Apache per TLS ausgeliefert. Gleiches Muster
wie `xml-viewer.status20.net` (xml-online-viewer) und `odata.status20.net` (JdbcOdata).

| Was | Wo |
|---|---|
| Container | `docker compose up -d --build` im Repo-Root (`docker-compose.yml`), Port `127.0.0.1:8094` |
| Apache | `apache/odata-viewer-status20.conf` → `/etc/apache2/sites-available/`, certbot erzeugt `…-le-ssl.conf` |
| Zertifikat | Let's Encrypt via `certbot --apache -d odata-viewer.status20.net` |
| Logs | `/var/log/apache2/odata-viewer-status20-*.log`, `docker compose logs -f` |

## Aktualisieren

```bash
cd ~/webdav/odata-online-viewer
git pull
docker compose up -d --build        # baut Frontend + Backend neu (Multi-Stage-Dockerfile)
curl -s https://odata-viewer.status20.net/api/health
```

Usage-Statistik und Feedback-Speicher sind hier **nicht** konfiguriert (kein `USAGE_DB_URL`);
die Instanz loggt Feedback nur ins Container-Log. Die öffentliche Instanz läuft auf Cloud Run,
siehe `scripts/deploy.sh` und `docs/DEPLOY_CLOUD_RUN.md`.
