/** Bindings & configuration for the Worker + Durable Objects. */
export interface Env {
	/** Static asset binding (the built React SPA in ./dist). */
	ASSETS: Fetcher;
	ROOMS: DurableObjectNamespace;
	LIMITERS: DurableObjectNamespace;
	/** Room lifetime without activity, seconds (default 1800 = 30 min). */
	ROOM_TTL_SECONDS?: string;
	/** Reconnection grace period, seconds (default 60). */
	GRACE_SECONDS?: string;
	/** Max room creations per IP per 10 minutes (default 10). */
	CREATE_LIMIT_PER_10MIN?: string;
	/** Max join attempts per IP per 10 minutes (default 30). */
	JOIN_LIMIT_PER_10MIN?: string;
}
