declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    ADMIN_EMAILS?: string;
    DOUYIN_CLIENT_KEY?: string;
    DOUYIN_CLIENT_SECRET?: string;
  }
}
