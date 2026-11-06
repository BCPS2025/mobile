/** Short commit SHA of this build, shown on the About page; "dev" outside CI builds and in unit tests. */
export const BUILD_SHA: string = typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'dev'
