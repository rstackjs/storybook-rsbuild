import { define } from 'rstack'

define.lib(async ({ command, env, envMode }) => ({
  source: {
    define: {
      FIXTURE_COMMAND: JSON.stringify(command),
      FIXTURE_ENV: JSON.stringify(env),
      FIXTURE_ENV_MODE: JSON.stringify(envMode),
    },
  },
  lib: [
    {
      source: {
        define: {
          FIXTURE_LIB: JSON.stringify('loaded'),
        },
      },
    },
  ],
}))
