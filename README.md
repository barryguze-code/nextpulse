# NextPulse

NextPulse ERP web application shell.

## Stack

- Vanilla HTML, CSS, and JavaScript
- Bootstrap 5.3 via CDN
- Bootstrap Icons via CDN
- No npm
- No build step

## Local Preview

Run a static server from this folder:

```bash
python3 -m http.server 5173
```

Then open:

```text
http://localhost:5173
```

The component loader uses `fetch()`, so opening `index.html` directly from the filesystem is not recommended.

Use `login.html` as the entry point once the API has `/api/auth/me` and `/api/auth/logout`.

## API

The default API base URL is:

```text
http://localhost:8080/api
```

Change it in:

```text
js/api.js
```
