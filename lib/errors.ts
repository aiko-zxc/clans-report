// Error envelope (see specs/api.md). Every AppError maps 1:1 to an api.md error
// code and its HTTP status; responses are RFC 7807 application/problem+json with
// an extra `code` field the FE switches on.

export const ERROR_STATUS = {
  INVALID_REQUEST: 400,
  UNAUTHENTICATED: 401,
  NOT_FOUNDER: 403,
  LISTING_NOT_FOUND: 404,
  NO_LISTING: 404,
  LISTING_ALREADY_EXISTS: 409,
  VERSION_CONFLICT: 409,
  STALE_LISTING_REMOVED: 410,
  BUNGIE_UNAVAILABLE: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

const STATUS_TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  410: 'Gone',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

function statusTitle(status: number): string {
  return STATUS_TITLES[status] ?? 'Error';
}

export function problem(code: ErrorCode, detail: string, instance?: string): Response {
  const status = ERROR_STATUS[code];
  return Response.json(
    { type: 'about:blank', title: statusTitle(status), status, detail, instance, code },
    { status, headers: { 'content-type': 'application/problem+json' } },
  );
}

// Catch-all for unexpected failures — not part of api.md's documented (intentional)
// codes, but every handler needs a 500 fallback. Kept distinct so real bugs surface
// as INTERNAL rather than being mislabelled as a known 4xx/503.
function internalError(instance?: string): Response {
  return Response.json(
    {
      type: 'about:blank',
      title: statusTitle(500),
      status: 500,
      detail: 'Unexpected error.',
      instance,
      code: 'INTERNAL',
    },
    { status: 500, headers: { 'content-type': 'application/problem+json' } },
  );
}

type RouteHandler<C> = (req: Request, ctx: C) => Promise<Response>;

// Wraps a route handler so thrown AppErrors become problem+json and anything else
// becomes a logged 500. The @RestControllerAdvice analog (see be.md).
export function handled<C>(handler: RouteHandler<C>): RouteHandler<C> {
  return async (req, ctx) => {
    const instance = new URL(req.url).pathname;
    try {
      return await handler(req, ctx);
    } catch (e) {
      if (e instanceof AppError) return problem(e.code, e.message, instance);
      console.error(e);
      return internalError(instance);
    }
  };
}
