# fund-analyzer

## Deployment database

User history, buy decision tracking, and comparison lists are stored in PostgreSQL.

Required environment variable:

```bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require"
```

`POSTGRES_URL` is also supported for Vercel-managed Postgres integrations.

The app creates these tables automatically on first API access:

- `histories`
- `decisions`
- `comparisons`

For Vercel deployment, bind a managed Postgres database such as Vercel Postgres, Neon, Supabase Postgres, or any provider that exposes a standard PostgreSQL connection string.
