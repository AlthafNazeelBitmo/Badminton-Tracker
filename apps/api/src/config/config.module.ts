import { Global, Module } from '@nestjs/common';
import { CONFIG_TOKEN, loadEnv, type Env } from './env';

/**
 * Validated configuration, available everywhere via `@Inject(CONFIG_TOKEN)`.
 *
 * Deliberately not `@nestjs/config`'s untyped `get(key)`: injecting the parsed object
 * means a typo in a config key is a compile error rather than an `undefined` at runtime.
 */
@Global()
@Module({
  providers: [
    {
      provide: CONFIG_TOKEN,
      useFactory: (): Env => loadEnv(),
    },
  ],
  exports: [CONFIG_TOKEN],
})
export class AppConfigModule {}
