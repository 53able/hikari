## [0.2.1](https://github.com/53able/hikari/compare/v0.2.0...v0.2.1) (2026-05-17)


### Bug Fixes

* detect EOTP on publish dry-run before npm publish ([#10](https://github.com/53able/hikari/issues/10)) ([5c32fee](https://github.com/53able/hikari/commit/5c32fee49e3e193679657b734091f551e2c913ba))
* drop prepublish dry-run before npm ci in release job ([#9](https://github.com/53able/hikari/issues/9)) ([93b026c](https://github.com/53able/hikari/commit/93b026c8a5a12118710fccdb76dd7f07d4dbfacc))
* prefer OIDC over classic NPM_TOKEN and fail early on EOTP ([1f723a0](https://github.com/53able/hikari/commit/1f723a0f7038b1d47323c798508a9f737128c005))
* publish to npm via OIDC trusted publishing ([aa9bb69](https://github.com/53able/hikari/commit/aa9bb6900d2236ece1b0d5825a138fb8d895bc72))
* restore NPM_TOKEN for semantic-release and sync missing publishes ([9e0202b](https://github.com/53able/hikari/commit/9e0202b1720d515e6d54b73d26ecbb2a61f563c2))
* write NPM_TOKEN to setup-node npmrc path ([#8](https://github.com/53able/hikari/issues/8)) ([b400287](https://github.com/53able/hikari/commit/b400287fd562253a2e1eeb628e0af5635abad95e))

# [0.2.0](https://github.com/53able/hikari/compare/v0.1.0...v0.2.0) (2026-05-17)


### Bug Fixes

* correct semantic-release branches for npm beta channel ([d75fe7d](https://github.com/53able/hikari/commit/d75fe7d6a591a277a9a295690fdf8e5be4f96a52))


### Features

* add devtools capability invoker for API-key-free smoke tests ([73fbbe9](https://github.com/53able/hikari/commit/73fbbe935e5fe8327c1e899f867f0d1738741078))
