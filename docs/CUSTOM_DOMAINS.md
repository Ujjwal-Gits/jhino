# Custom domains

Jhino can host an app at the customer's own domain, for example `yourstudio.com` or `app.yourstudio.com`.
The domain serves the complete app at its own top level. It is not a redirect and not a frame. Saved data,
files, live updates, password links and guests all work the same as on jhino.com.

- **Who can connect a domain:** Pro includes 1 custom domain. Free and Plus include none. Super admins have no
  limit. Change the numbers in Super Admin → Plans & pricing → Custom domains. The server enforces the limit.
- **Where to connect one:** open the app, then Share → Custom domain. Enter the domain and choose the www option.
  Jhino then shows the exact DNS records to add, each with a copy button, and the status: Waiting for DNS →
  Issuing certificate → Live. Use Check now to check again straight away.
- **Super Admin → Custom domains** lists every domain with its status, owner and app. From there you can check a
  domain again, switch it off or remove it. Each of these actions goes in the audit log, and the owner is told.
- **"Built with Jhino":** every HTML page served on a custom domain ends with one small line under the site's own
  footer. It links to `https://jhino.com/?ref=<domain>` as a normal followed link (`rel="noopener"`). The line is
  28px high, sits in the page flow so it never covers fixed content, and is isolated in a shadow DOM so the
  site's CSS cannot restyle or hide it. Only a super admin can switch it off, and only on domains they own
  (the checkbox on their domain card, or "Hide line" in Super Admin). Nothing changes for pages on jhino.com.

## How it works

1. The owner adds `shop.com`. Jhino stores it in `custom_domains`. A hostname can be connected only once across
   the whole platform. Jhino's own names, IP addresses and names like `.local` or `.test` are refused.
2. Jhino checks the domain in the background. It checks straight away, then backs off from 1 minute up to
   6 hours between checks. Live domains are checked once a day. The owner gets a notification when the domain
   goes live and when it stops working. A live domain counts as broken only after two failed checks in a row.
3. When a request arrives with `Host: shop.com` and the domain is live, Jhino serves the app's files at `/`.
   The runtime shim runs in **direct mode**: it calls `/api/apps/<id>/…` and `/api/events` on `shop.com` itself.
   That host accepts only those API calls, for that one app.
4. Access follows the app's Share settings:
   - **Private:** the domain shows "This site is not public yet".
   - **Public, view only:** the site opens straight away.
   - **Password:** a password page is shown first.
   - **Visitors can add or edit:** the visitor gives a name first and becomes a guest in that app.
5. Security:
   - Jhino's session cookie (`jhino_sid`) and app keys are never accepted on a custom domain.
   - The visit cookie set there (`jp_<app>`) is host-only, `HttpOnly`, `Secure` and `SameSite=Lax`.
   - The password form carries its own CSRF token (a double-submit cookie). Tries are rate-limited.
   - Pages get a policy suited to a site (`frame-ancestors 'self'`, `object-src 'none'`, `base-uri 'self'`).
     Files people upload inside the app are served sandboxed.
   - HSTS is sent without `includeSubDomains`, so the rest of the customer's domain is left alone.
6. For search engines:
   - `robots.txt` and `sitemap.xml` are generated for each domain. A robots.txt or sitemap.xml inside the app's
     own files is served instead.
   - A canonical link points at the custom domain.
   - The site gets its own web app manifest and icons.
   - Only public, view-only sites can be indexed. Everything else is sent with `noindex`.
7. **www:** for a main domain, the owner chooses between two setups:
   - `shop.com` is the address, and `www.shop.com` forwards to it with a 301.
   - `www.shop.com` is the address, and `shop.com` forwards to it.

   Both names need a DNS record.
8. If the owner's Pro plan ends, the domain shows "This site is paused" until they renew. Domains a super admin
   connected for someone else are not counted against that person's plan.
9. When an app is deleted for good, its domains are removed, at Cloudflare as well.

## Option A (recommended): Cloudflare for SaaS

Cloudflare issues and renews the certificates, validates each hostname and proxies the traffic to Jhino.

### Costs and limits

Checked against Cloudflare's documentation in September 2026. Check the current page before you rely on these
numbers: <https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/>

| | |
| --- | --- |
| Included on every plan, the Free plan too | 100 custom hostnames |
| Each hostname after that (Free, Pro and Business plans) | USD 0.10 a month |
| Most custom hostnames on Free, Pro or Business | 50,000 |

A domain with the www option uses two hostnames: `shop.com` and `www.shop.com`.

### One-time setup on the jhino.com zone

1. **Turn on Cloudflare for SaaS.** In the Cloudflare dashboard, go to jhino.com → SSL/TLS → Custom Hostnames and
   enable it. It asks for a payment method even on the free allowance.
2. **Create the fallback origin record.** Add a DNS record `origin.jhino.com`: an `A` record to the server's IP
   (currently 187.126.114.230). It must be **proxied** (orange cloud).
3. **Set the fallback origin.** Under Custom Hostnames → Fallback Origin, enter `origin.jhino.com`. Wait until it
   shows **Active**.
4. **Create the CNAME target.** Add `cname.jhino.com` as a `CNAME` to `origin.jhino.com`, **proxied**. Customers
   point their domains at this name.
5. **Set the SSL mode for custom domains.** Cloudflare connects to the fallback origin with SNI and `Host` set to
   the customer's hostname. The server has no certificate for those names, so **Full (strict)** would fail with
   error 526. The zone is on Full (strict), so add a configuration rule:
   - Go to Rules → Configuration Rules → Create rule.
   - Use the expression `not http.host in {"jhino.com" "www.jhino.com"}`, or match on `cf.tls_client_auth` /
     `http.host` in the way you prefer.
   - Set **SSL: Full**.

   The Hostinger firewall already lets only Cloudflare's IP ranges reach ports 80 and 443. So the
   Cloudflare-to-server hop only accepts traffic from Cloudflare.
6. **Create an API token.** Go to My Profile → API Tokens → Create token → Custom token, with these settings:
   - **Permissions:** `Zone → SSL and Certificates → Edit`. If your account lists **Custom Hostnames** as a
     separate permission, add `Zone → Custom Hostnames → Edit` as well.
   - **Zone resources:** Include → Specific zone → jhino.com.
   - Copy the token. It is shown once.
7. **Copy the Zone ID.** It is on the zone's Overview page, in the right-hand column.

### Coolify / Traefik: let custom hostnames reach the container

Coolify's Traefik only routes the hostnames it knows. Requests for customer domains need a catch-all router that
points at the Jhino service. Add these labels in the Jhino resource → Configuration → Container labels:

```
traefik.http.routers.jhino-custom.rule=HostRegexp(`^.+$`)
traefik.http.routers.jhino-custom.entrypoints=https
traefik.http.routers.jhino-custom.tls=true
traefik.http.routers.jhino-custom.priority=1
traefik.http.routers.jhino-custom.service=<the service name from the existing jhino labels>
traefik.http.routers.jhino-custom-http.rule=HostRegexp(`^.+$`)
traefik.http.routers.jhino-custom-http.entrypoints=http
traefik.http.routers.jhino-custom-http.priority=1
traefik.http.routers.jhino-custom-http.service=<the same service name>
```

Some details about these labels:

- `priority=1` keeps jhino.com on its own router.
- `tls=true` without a certresolver means Traefik presents its default certificate. With the SSL mode set to Full
  in step 5, Cloudflare accepts that.
- Older Traefik v2 uses ``HostRegexp(`{host:.+}`)`` instead.

After a redeploy, check that `curl -H "Host: anything.example" http://<server-ip>/` (from the server) returns
Jhino's "There is no site here" page.

### Environment variables (Coolify → Environment Variables)

```
CF_API_TOKEN=<the token from step 6>
CF_ZONE_ID=<the zone id from step 7>
CF_FALLBACK_ORIGIN=origin.jhino.com
CUSTOM_DOMAIN_CNAME_TARGET=cname.jhino.com
# Optional:
CF_SSL_METHOD=http            # or txt: the customer then also adds a TXT record for the certificate
CUSTOM_DOMAIN_A_RECORD=       # only if you have Cloudflare apex proxying (dedicated IPs); shown as an A-record option
PLATFORM_HOSTS=               # other names this server answers as Jhino itself, comma-separated (e.g. a sslip.io name)
```

Redeploy after you change them. `PUBLIC_URL` must be set (`https://jhino.com`). Without it, requests from hosts
Jhino does not know are served as Jhino instead of getting the "There is no site here" page.

### What the customer adds

For `app.shop.com`:

| Type | Name | Value |
| --- | --- | --- |
| CNAME | `app` | `cname.jhino.com` |

For `shop.com` with the www option, there are two records:

| Type | Name | Value |
| --- | --- | --- |
| CNAME | `@` | `cname.jhino.com` |
| CNAME | `www` | `cname.jhino.com` |

About these records:

- **Root domains (`@`):** most DNS providers do not allow a CNAME on the root domain. The customer uses their
  provider's ALIAS or ANAME record, or CNAME flattening. Cloudflare DNS flattens automatically.
- **Customers on Cloudflare DNS:** they must leave the record **DNS only** (grey cloud) for their own zone, unless
  they use Cloudflare's "Orange-to-Orange" setup.
- **Ownership TXT record (optional):** Jhino also shows the TXT record Cloudflare gives for proving ownership
  (`_cf-custom-hostname.…`). Adding it first lets Cloudflare verify the domain before the CNAME is switched, so
  there is no gap in service.
- **`CF_SSL_METHOD=txt`:** the certificate's TXT record is shown as required.

## Option B: self-managed certificates (no Cloudflare)

This option is used when `CF_API_TOKEN` or `CF_ZONE_ID` is not set. Jhino checks ownership itself, with a TXT
record. The reverse proxy issues certificates on demand, and Jhino tells it which domains are allowed.

Customers add these records:

| Type | Name | Value |
| --- | --- | --- |
| TXT | `_jhino` (that is, `_jhino.shop.com`) | `jhino-verify=…` (shown in Share → Custom domain) |
| A | `@` | `CUSTOM_DOMAIN_A_RECORD` (the server's public IP) |
| CNAME | `app` | `CUSTOM_DOMAIN_CNAME_TARGET` (for subdomains) |

When both records are found, the domain moves to **Issuing certificate**. `GET /api/domains/tls-ask?domain=shop.com`
now answers 200. It answers 404 for anything else. Jhino then fetches `https://shop.com/__jhino/ping`. When that
returns Jhino's token over a valid certificate, the domain is **Live**.

Caddy example (Caddy in front of Jhino, on ports 80 and 443):

```
{
  on_demand_tls {
    ask http://127.0.0.1:4310/api/domains/tls-ask
  }
}

jhino.com, www.jhino.com {
  reverse_proxy 127.0.0.1:4310
}

# Every other name: only those Jhino says yes to get a certificate.
https:// {
  tls {
    on_demand
  }
  reverse_proxy 127.0.0.1:4310
}
```

Environment:

```
CUSTOM_DOMAIN_A_RECORD=203.0.113.10
CUSTOM_DOMAIN_CNAME_TARGET=sites.jhino.com   # a name that resolves to the same server (optional)
CUSTOM_DOMAIN_DNS_SERVERS=1.1.1.1,8.8.8.8     # resolvers for the checks; "system" uses the container's own
```

With Coolify's Traefik, on-demand certificates need a plugin or a Caddy container in front. Caddy is simpler.
Option A avoids this entirely.

## Testing with a real domain

1. Sign in as a Pro customer, or as a super admin. Open an app, then Share. Set "Who can open the link" to
   **Anyone with the link**.
2. Under Custom domain → Connect a domain, enter a domain you control, for example `test.yourdomain.com`.
3. Add the CNAME that is shown, at your DNS provider. Press **Check now** after a minute. The status moves to
   Issuing certificate and then Live, usually within a few minutes with Cloudflare.
4. Open `https://test.yourdomain.com`:
   - The app loads at the top level: no Jhino bar, no frame.
   - Save something, then open the same app on jhino.com in another browser. The change appears there live, and
     changes made there appear on the domain.
   - The page ends with the "Built with Jhino" line.
   - Check `https://test.yourdomain.com/robots.txt` and `/sitemap.xml`.
   - Switch the app to a password link. The domain now asks for the password.
5. In Super Admin → Custom domains, the domain appears. Check, Switch off and Remove all work. Remove also
   deletes the hostname in Cloudflare (SSL/TLS → Custom Hostnames).

### Local smoke test (no DNS)

Local testing does not need DNS:

1. Set `PUBLIC_URL`.
2. Insert a row in `custom_domains` with `status='active'`.
3. Send a request with a `Host` header:

```
curl -H "Host: shop.example.com" http://127.0.0.1:4310/
```
