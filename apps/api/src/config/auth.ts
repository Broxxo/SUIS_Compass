/** JWT 有效期默认 7 天 */
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
/** 密钥，未设置时拒绝签发/校验 */
export const JWT_SECRET = process.env.JWT_SECRET || '';
