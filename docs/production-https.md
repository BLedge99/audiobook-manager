# Production web HTTPS

The production web app uses Caddy's local certificate authority at
`https://books.home.arpa`. The Android wrapper continues to use its configured
LAN HTTP address on port 3000, as recorded in ADR 014. Keep it on a trusted
household network; the web HTTPS setup does not encrypt that Android connection.

## Start the production stack

1. Install Docker Engine / Docker Desktop with Compose on the server.
2. Create a `.env` beside `docker-compose.prod.yml` with a strong, unique
   `APP_PASSWORD` for break-glass recovery and an independent 32-byte
   `MEDIA_TOKEN_SECRET`. To generate the latter in PowerShell:

   ```powershell
   $mediaSecret = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
   Add-Content .env "MEDIA_TOKEN_SECRET=$mediaSecret"
   Remove-Variable mediaSecret
   ```

   Keep `.env` private and out of backups that are shared broadly.
3. Set the server's LAN address to a DHCP reservation. In the router's local DNS,
   map `books.home.arpa` to that address. If the router cannot provide local DNS,
   add the same mapping to each Windows machine's hosts file from an elevated
   PowerShell window, replacing the example address:

   ```powershell
   Add-Content "$env:SystemRoot\System32\drivers\etc\hosts" "192.168.1.203 books.home.arpa"
   ```

4. Start the stack from the repository directory:

   ```powershell
   docker compose -f docker-compose.prod.yml up -d --build
   ```

   The web API is only intended to be used at `https://books.home.arpa`. Port
   3000 also remains published for the Android wrapper.

## Check the configuration before deploying

Both files can be validated without starting anything. Run these from the
repository root on the machine that will host the stack:

```powershell
docker compose -f docker-compose.prod.yml config > $null   # resolves the file and its .env
docker run --rm -v "${PWD}/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2.11.7-alpine caddy validate --config /etc/caddy/Caddyfile
```

`Caddyfile` reported `Valid configuration` with `caddy:2.11.7-alpine` on
2026-10-26, and the production Compose file resolved with `compose config: ok`.
Neither check proves the browser will trust the CA; that is the next section.

## Trust Caddy's local CA on Windows

The first HTTPS request causes Caddy to create its local CA and issue the site
certificate. Its private CA key stays in the `caddy_data` Docker volume. Export
only the public root certificate to a Windows machine:

```powershell
docker compose -f docker-compose.prod.yml exec caddy sh -c 'test -s /data/caddy/pki/authorities/local/root.crt'
docker compose -f docker-compose.prod.yml cp caddy:/data/caddy/pki/authorities/local/root.crt .\caddy-root.crt
certutil -user -addstore Root .\caddy-root.crt
```

Trust the certificate only on household computers that should use this server.
Do not copy or distribute `root.key`, and do not delete the `caddy_data` volume:
it holds the CA identity used to sign the site certificate. Back it up like a
private key. Open `https://books.home.arpa` in Edge or Chrome and verify that
the browser reports a trusted connection before registering a passkey.

To remove this trust later, run `certmgr.msc`, open **Trusted Root Certification
Authorities → Certificates**, and remove the `Caddy Local Authority` entry.

## Configuration and recovery

- Caddy listens on ports 80 and 443; HTTP is redirected to HTTPS. UDP 443 is
  published for HTTP/3.
- `COOKIE_SECURE=true`, `WEBAUTHN_RP_ID=books.home.arpa`, and
  `WEBAUTHN_ORIGIN=https://books.home.arpa` are set by the production Compose
  file. Do not serve the web app under another hostname without changing the RP
  id and origin before registering passkeys.
- Compose places Caddy at `172.30.28.2` on a dedicated network, and the API
  trusts forwarded client addresses only from that proxy. If that subnet is
  already in use on the server, change the subnet and both static addresses in
  `docker-compose.prod.yml`, and set `TRUST_PROXY` to Caddy's new address.
- The required `MEDIA_TOKEN_SECRET` must be at least 32 bytes and independent
  from `APP_PASSWORD`. Rotating it invalidates media URLs already issued; it
  does not invalidate profile sessions.
- Caddy's configuration is in `Caddyfile`; the API is not exposed through any
  other Caddy route.
- To refresh containers after an update, run
  `docker compose -f docker-compose.prod.yml up -d --build`.
- A local CA is not publicly trusted and is not remote access. Do not expose
  ports 80, 443 or 3000 to the internet. ADR 006 keeps the service LAN-only.
