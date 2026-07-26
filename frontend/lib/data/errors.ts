/** Thrown when a repository implementation cannot support an interface method. */
export class RepositoryUnsupportedError extends Error {
  constructor(
    public readonly repository: string,
    public readonly method: string,
  ) {
    super(`${repository} does not support ${method}()`);
    this.name = 'RepositoryUnsupportedError';
  }
}
