import { describe, expect, it } from 'vitest';
import { ApiError, CdpError, ErrorCode, NetworkError, ScalebrowserError, errorMessage } from '../src/errors';

describe('ApiError', () => {
  it('derives a message from the daemon body', () => {
    const err = new ApiError(409, { code: 4002, message: 'geo check failed' });
    expect(err.status).toBe(409);
    expect(err.code).toBe(4002);
    expect(err.message).toBe('geo check failed');
    expect(err).toBeInstanceOf(ScalebrowserError);
  });

  it('falls back to a coded label when no message is present', () => {
    const err = new ApiError(429, { code: ErrorCode.Capacity });
    expect(err.code).toBe(4003);
    expect(err.codeLabel).toBe('Capacity exceeded');
    expect(err.message).toBe('Capacity exceeded');
  });

  it('flags auth errors via status or code', () => {
    expect(new ApiError(401, undefined).isAuthError).toBe(true);
    expect(new ApiError(200, { code: ErrorCode.Unauthorized }).isAuthError).toBe(true);
    expect(new ApiError(404, { code: 4001 }).isAuthError).toBe(false);
  });
});

describe('error helpers', () => {
  it('NetworkError carries a cause', () => {
    const cause = new Error('ECONNREFUSED');
    const err = new NetworkError('unreachable', cause);
    expect(err.cause).toBe(cause);
    expect(err).toBeInstanceOf(ScalebrowserError);
  });

  it('CdpError carries a numeric code', () => {
    const err = new CdpError(-32000, 'boom');
    expect(err.code).toBe(-32000);
    expect(err.message).toBe('boom');
  });

  it('errorMessage narrows unknown values', () => {
    expect(errorMessage(new Error('x'))).toBe('x');
    expect(errorMessage('plain')).toBe('plain');
  });
});
