# [1.53.0](https://github.com/simwai/biome-formatter-vscode/compare/v1.52.0...v1.53.0) (2026-05-29)


### Bug Fixes

* waterfall binary resolution with executable probing and single-flight cache ([#16](https://github.com/simwai/biome-formatter-vscode/issues/16)) ([5e5786e](https://github.com/simwai/biome-formatter-vscode/commit/5e5786eaaf29db5012298ec2d9f343ec1e08db58))


### Features

* add "Fix Project" command ([#14](https://github.com/simwai/biome-formatter-vscode/issues/14)) ([c6702bf](https://github.com/simwai/biome-formatter-vscode/commit/c6702bf80ace7c92f9e0e3021813d416c31552c0))
* add format project command and update configuration defaults ([#13](https://github.com/simwai/biome-formatter-vscode/issues/13)) ([a117244](https://github.com/simwai/biome-formatter-vscode/commit/a1172449584fe2da6bb7b95ea50dff60a469b0b1))

# [1.52.0](https://github.com/simwai/biome-formatter-vscode/compare/v1.51.1...v1.52.0) (2026-05-07)


### Bug Fixes

* disable successComment in @semantic-release/github to prevent 404 on missing PRs ([89ce71b](https://github.com/simwai/biome-formatter-vscode/commit/89ce71b9aa7d45207e5828208dc3b117b4ef4739))
* remove release notes from git commit message to prevent Windows command line length overflow ([eaddba1](https://github.com/simwai/biome-formatter-vscode/commit/eaddba18334b902f285297048a14aef9f4e4eb12))


### Features

* add semantic-release and commitlint configuration ([#11](https://github.com/simwai/biome-formatter-vscode/issues/11)) ([3a8d0ec](https://github.com/simwai/biome-formatter-vscode/commit/3a8d0ec3f3f6e97f0eef3641b65e688c98413d97))


### Reverts

* reverted package.json and related changes ([306e21f](https://github.com/simwai/biome-formatter-vscode/commit/306e21fe333b26ff768a9efaca7be554956ddef1))

## [1.0.1](https://github.com/simwai/biome-formatter-vscode/compare/v1.0.0...v1.0.1) (2026-05-07)


### Bug Fixes

* disable successComment in @semantic-release/github to prevent 404 on missing PRs ([89ce71b](https://github.com/simwai/biome-formatter-vscode/commit/89ce71b9aa7d45207e5828208dc3b117b4ef4739))

# 1.0.0 (2026-05-06)


### Bug Fixes

* `oxc.typeAware` default value to `null` + not send null values to servers ([#109](https://github.com/simwai/biome-formatter-vscode/issues/109)) ([545551a](https://github.com/simwai/biome-formatter-vscode/commit/545551a59c4b83827c76d182a2d714e03527d23b))
* **apps, editors, napi:** fix `oxlint-disable` comments ([#16014](https://github.com/simwai/biome-formatter-vscode/issues/16014)) ([fd76e7c](https://github.com/simwai/biome-formatter-vscode/commit/fd76e7c847083ff2fb6f6abb1b981d3aa664fd84))
* dispose client connection ([#135](https://github.com/simwai/biome-formatter-vscode/issues/135)) ([1884100](https://github.com/simwai/biome-formatter-vscode/commit/1884100d2333b5e3a309d4c1f9f49f90d4d1383e))
* don't set warn background when all binaries are not found ([#46](https://github.com/simwai/biome-formatter-vscode/issues/46)) ([d835ed6](https://github.com/simwai/biome-formatter-vscode/commit/d835ed6ba5b81961d2598dc3156db7c9a270d751))
* **editor/vscode:** set minimum supported ver. to `^1.93.0` ([#8182](https://github.com/simwai/biome-formatter-vscode/issues/8182)) ([0842e2e](https://github.com/simwai/biome-formatter-vscode/commit/0842e2e442316e7a4e24b7a08961771a9c3784ee))
* **editor/vscode:** Update language client id to fix the resolution of the oxc.trace.server setting ([#7181](https://github.com/simwai/biome-formatter-vscode/issues/7181)) ([591e6be](https://github.com/simwai/biome-formatter-vscode/commit/591e6bebba5b247a8d2ef04be04ad8f152b35e52))
* **editor:** activate extension when astro files are opened too ([#10725](https://github.com/simwai/biome-formatter-vscode/issues/10725)) ([0965582](https://github.com/simwai/biome-formatter-vscode/commit/0965582b636a8078d48b26d906c1510a58fe047d))
* **editor:** add notice for a possible restart when fixing `filename-case` ([#13557](https://github.com/simwai/biome-formatter-vscode/issues/13557)) ([7450c45](https://github.com/simwai/biome-formatter-vscode/commit/7450c45c7b0f9cafda191a008f592aed5a2484d7)), closes [#12404](https://github.com/simwai/biome-formatter-vscode/issues/12404)
* **editor:** detect all workspaces config path changes ([#11016](https://github.com/simwai/biome-formatter-vscode/issues/11016)) ([c997253](https://github.com/simwai/biome-formatter-vscode/commit/c997253302a30b91849c7d2477a8d65809a1d8ef)), closes [#10515](https://github.com/simwai/biome-formatter-vscode/issues/10515) [#10875](https://github.com/simwai/biome-formatter-vscode/issues/10875)
* **editor:** don't allow `oxc.path.server` for untrusted workspaces ([#13734](https://github.com/simwai/biome-formatter-vscode/issues/13734)) ([a46e2df](https://github.com/simwai/biome-formatter-vscode/commit/a46e2df214e741eb01a8296d4b3550ff3c131c79))
* **editor:** dont send `didChangeConfiguration` request to the server when it is shutdown ([#10084](https://github.com/simwai/biome-formatter-vscode/issues/10084)) ([a35b136](https://github.com/simwai/biome-formatter-vscode/commit/a35b1360a820e3be93e1278b2aa094c9e7ffe6a5))
* **editor:** execute `oxc.path.server` in win32 with shell ([#14203](https://github.com/simwai/biome-formatter-vscode/issues/14203)) ([0817320](https://github.com/simwai/biome-formatter-vscode/commit/0817320a14cb9a761680f3fbe530233489540705)), closes [#14167](https://github.com/simwai/biome-formatter-vscode/issues/14167)
* **editor:** fix memory leaks when server or watchers restarted ([#10628](https://github.com/simwai/biome-formatter-vscode/issues/10628)) ([c7f90b4](https://github.com/simwai/biome-formatter-vscode/commit/c7f90b4fb4190739a56e3b04f8215558084d8f03)), closes [#10627](https://github.com/simwai/biome-formatter-vscode/issues/10627)
* **editor:** Fix onConfigChange to send the correct config for didChangeConfiguration notification ([#6962](https://github.com/simwai/biome-formatter-vscode/issues/6962)) ([2fe42e4](https://github.com/simwai/biome-formatter-vscode/commit/2fe42e4d2ff992b9c9b4b243108c8894f49c1ef8))
* **editor:** misaligned command prefixes ([#6628](https://github.com/simwai/biome-formatter-vscode/issues/6628)) ([aef004b](https://github.com/simwai/biome-formatter-vscode/commit/aef004b442e87367eb82220dec4bc9c379e1bcf8))
* **editor:** reload workspace configuration after change ([#7302](https://github.com/simwai/biome-formatter-vscode/issues/7302)) ([fe9f8d1](https://github.com/simwai/biome-formatter-vscode/commit/fe9f8d121f955377d0c77035f5b38a066853d73f))
* **editor:** repair filewatchers when no custom config provided ([#10104](https://github.com/simwai/biome-formatter-vscode/issues/10104)) ([a4259f3](https://github.com/simwai/biome-formatter-vscode/commit/a4259f3b68f14bd2fbdf7befdb67b04525c22a49))
* **editor:** restrict servers paths for  `oxc.path.server` ([#13740](https://github.com/simwai/biome-formatter-vscode/issues/13740)) ([6a71aa7](https://github.com/simwai/biome-formatter-vscode/commit/6a71aa729eceaeeb3de7a64becc63532846952d9)), closes [#13734](https://github.com/simwai/biome-formatter-vscode/issues/13734)
* **editors/vscode:** fix `no-useless-call` warning ([627d045](https://github.com/simwai/biome-formatter-vscode/commit/627d04556e6c87efa61fd9bee11d9cf36a896b10))
* **editors/vscode:** temporarily solve oxc_language_server issue on windows ([#6384](https://github.com/simwai/biome-formatter-vscode/issues/6384)) ([bf7e5b0](https://github.com/simwai/biome-formatter-vscode/commit/bf7e5b013329cd5b437d5d71cf11f3215cc802ad)), closes [#6382](https://github.com/simwai/biome-formatter-vscode/issues/6382)
* **editor:** send only `workspace/didChangeConfiguration` when some workspace configuration is effected ([#11017](https://github.com/simwai/biome-formatter-vscode/issues/11017)) ([739c42f](https://github.com/simwai/biome-formatter-vscode/commit/739c42f10b514e71cf5011d76d8bf6513818799c)), closes [#10515](https://github.com/simwai/biome-formatter-vscode/issues/10515) [#10875](https://github.com/simwai/biome-formatter-vscode/issues/10875)
* **editor:** stop client when delete .oxlintrc.json with `oxc.requireConfig` ([#14897](https://github.com/simwai/biome-formatter-vscode/issues/14897)) ([b570490](https://github.com/simwai/biome-formatter-vscode/commit/b57049043229a0106e9f06d76df56089b8906f51)), closes [#14896](https://github.com/simwai/biome-formatter-vscode/issues/14896)
* **editor:** stricter path validation for `oxc.path.server` ([#14202](https://github.com/simwai/biome-formatter-vscode/issues/14202)) ([88c95fd](https://github.com/simwai/biome-formatter-vscode/commit/88c95fd64b3dedc85a2d4a9fb51cf396e41b4f29))
* **editor:** strip leading slash for bin path on windows ([#13738](https://github.com/simwai/biome-formatter-vscode/issues/13738)) ([0015f30](https://github.com/simwai/biome-formatter-vscode/commit/0015f30f24ddd64a4cdd9bb994c1d035d1a6658e))
* **editor:** update `initializationOptions` for a possible restart ([#10121](https://github.com/simwai/biome-formatter-vscode/issues/10121)) ([09773dd](https://github.com/simwai/biome-formatter-vscode/commit/09773dddea8675f0e4dadf4582f01a0d4c5739ff))
* **editor:** Update config sent to language server ([#6724](https://github.com/simwai/biome-formatter-vscode/issues/6724)) ([e8abb5d](https://github.com/simwai/biome-formatter-vscode/commit/e8abb5d355605919aef28960b2748a7defc414a1))
* **editor:** use human-readable output channel names ([#6629](https://github.com/simwai/biome-formatter-vscode/issues/6629)) ([6912550](https://github.com/simwai/biome-formatter-vscode/commit/6912550b7411039a23b0b254821f13be039f8986))
* improve Node.js resolution for LSP helper ([#98](https://github.com/simwai/biome-formatter-vscode/issues/98)) ([2264ef6](https://github.com/simwai/biome-formatter-vscode/commit/2264ef6852fdc2469da6a12dccb3f635ecfebec9))
* **language_server:** don't apply "ignore this rule" fixes for fixAll code action + command ([#14243](https://github.com/simwai/biome-formatter-vscode/issues/14243)) ([a3fc756](https://github.com/simwai/biome-formatter-vscode/commit/a3fc7569268b7aca47d75c31666f2b54d9eb2531))
* **language_server:** don't lint file on code action when it is already ignored ([#13976](https://github.com/simwai/biome-formatter-vscode/issues/13976)) ([59c0258](https://github.com/simwai/biome-formatter-vscode/commit/59c0258c0e15fb36bd8289bc1e8bb79d44ef5353)), closes [#13778](https://github.com/simwai/biome-formatter-vscode/issues/13778)
* **language_server:** include the diagnostic of the other linter ([#13490](https://github.com/simwai/biome-formatter-vscode/issues/13490)) ([0aac104](https://github.com/simwai/biome-formatter-vscode/commit/0aac104022caa2681bd69d7c7a7f490d97109d06)), closes [#13480](https://github.com/simwai/biome-formatter-vscode/issues/13480)
* **language_server:** make unused directives fixable again ([#14872](https://github.com/simwai/biome-formatter-vscode/issues/14872)) ([65c76ab](https://github.com/simwai/biome-formatter-vscode/commit/65c76ab8baff34759be59b6e174593807c02ad6b))
* **language_server:** on configuration change, send updated diagnostics to the client ([#10764](https://github.com/simwai/biome-formatter-vscode/issues/10764)) ([1d4dbb7](https://github.com/simwai/biome-formatter-vscode/commit/1d4dbb7619cfa72bfb448c72f5880528322dc1ec))
* **language_server:** workspace edits as one batch when `source.fixAll.oxc` is the context ([#10428](https://github.com/simwai/biome-formatter-vscode/issues/10428)) ([4e9b6d7](https://github.com/simwai/biome-formatter-vscode/commit/4e9b6d79f28ca8a23fa0b05b7597c73bde7eccc2)), closes [#10422](https://github.com/simwai/biome-formatter-vscode/issues/10422)
* **lsp:** make the server available in nvim-lspconfig ([#1823](https://github.com/simwai/biome-formatter-vscode/issues/1823)) ([2bda97b](https://github.com/simwai/biome-formatter-vscode/commit/2bda97b0fab7cc1e867f0f501f76d2975c878b2c))
* **oxc_vscode:** vscode extension - check on file change (not on file save)  ([#1525](https://github.com/simwai/biome-formatter-vscode/issues/1525)) ([37a08d9](https://github.com/simwai/biome-formatter-vscode/commit/37a08d978bc5f565a8ebed877e8007088a3e9f1b))
* **oxlint/lsp:** skip dangerous fixes/suggestions for "fix all" code action and command ([#18364](https://github.com/simwai/biome-formatter-vscode/issues/18364)) ([85c9094](https://github.com/simwai/biome-formatter-vscode/commit/85c909476e7199f0e9047a1248f1f6d1e355b6d9))
* parse package.json "bin" field instead of hardcoding dist/index.js → bin/ ([#90](https://github.com/simwai/biome-formatter-vscode/issues/90)) ([0af9d1f](https://github.com/simwai/biome-formatter-vscode/commit/0af9d1f94931869abc72b04a2e4f12345d0fde72))
* **release:** pass --pre-release flag during packaging ([3909c81](https://github.com/simwai/biome-formatter-vscode/commit/3909c818acc1f0b54d13eead6d9e50d99bc1709f))
* **release:** use commit message marker for pre-release detection ([e82d107](https://github.com/simwai/biome-formatter-vscode/commit/e82d107083e4b66abd4e51a0333e0fe58651af9f))
* **release:** use fetch-depth 2 for version diff check ([11b658e](https://github.com/simwai/biome-formatter-vscode/commit/11b658ecfee953cad5d8adcce8e7e0e0fb7bd650))
* remove release notes from git commit message to prevent Windows command line length overflow ([eaddba1](https://github.com/simwai/biome-formatter-vscode/commit/eaddba18334b902f285297048a14aef9f4e4eb12))
* support language id without `scheme` ([#80](https://github.com/simwai/biome-formatter-vscode/issues/80)) ([c53242f](https://github.com/simwai/biome-formatter-vscode/commit/c53242f89d65faafbed283664a6ad6995393aee7))
* update status bar item icon when enabling/disabling tools ([#47](https://github.com/simwai/biome-formatter-vscode/issues/47)) ([90b8b28](https://github.com/simwai/biome-formatter-vscode/commit/90b8b2826f9bab3c2d912ff7b30a6bf80091e4d9))
* update status bar item tooltip after changes ([#43](https://github.com/simwai/biome-formatter-vscode/issues/43)) ([832f0ff](https://github.com/simwai/biome-formatter-vscode/commit/832f0ff3f8f7325010582d6c3c48c4d58d8c1d5c))
* use `oxc.path.node` to run lsp connection ([#79](https://github.com/simwai/biome-formatter-vscode/issues/79)) ([734f1f7](https://github.com/simwai/biome-formatter-vscode/commit/734f1f7141cb0006995bbe706ba3f8f89e509067))
* use explicit command for package:pre-release ([2dded1a](https://github.com/simwai/biome-formatter-vscode/commit/2dded1a86afe07c9752877daf7c3238ebf334452))
* use system `node` on macOS to avoid code signing crash ([#124](https://github.com/simwai/biome-formatter-vscode/issues/124)) ([ea307aa](https://github.com/simwai/biome-formatter-vscode/commit/ea307aa5f653b9a6a828336305f72f462d11a728)), closes [#21](https://github.com/simwai/biome-formatter-vscode/issues/21)
* **vscode/test:** make formatting test less flaky ([#15120](https://github.com/simwai/biome-formatter-vscode/issues/15120)) ([eb9357f](https://github.com/simwai/biome-formatter-vscode/commit/eb9357fd1170dd07b698df203acdd0a751cbd75c))
* **vscode:** change all names to oxc_language_server ([8e9f616](https://github.com/simwai/biome-formatter-vscode/commit/8e9f6169eb99c321e625d3073aaacefbb9df8de9))
* **vscode:** don't lint files in .gitignore and .eslintignore ([#1765](https://github.com/simwai/biome-formatter-vscode/issues/1765)) ([ed1b385](https://github.com/simwai/biome-formatter-vscode/commit/ed1b385470974679ecc11417793f5ad5224d2a8b))
* **vscode:** fallback to workspace .bin for formatter binary lookup ([#57](https://github.com/simwai/biome-formatter-vscode/issues/57)) ([66aeeda](https://github.com/simwai/biome-formatter-vscode/commit/66aeeda31298d71a2f91ff10b0f66f47cd861103))
* **vscode:** fix commands by reverting commit `259a47b` ([#8819](https://github.com/simwai/biome-formatter-vscode/issues/8819)) ([3d3fc6d](https://github.com/simwai/biome-formatter-vscode/commit/3d3fc6d7d427e7426d440ad3a2d03af55a6260f6)), closes [#8787](https://github.com/simwai/biome-formatter-vscode/issues/8787)
* **vscode:** fix nested search for binaries ([#17832](https://github.com/simwai/biome-formatter-vscode/issues/17832)) ([39eede5](https://github.com/simwai/biome-formatter-vscode/commit/39eede572612d4481da4a367465afc5ffd52ab0e))
* **vscode:** fix statusbar icon order ([#12544](https://github.com/simwai/biome-formatter-vscode/issues/12544)) ([1328a75](https://github.com/simwai/biome-formatter-vscode/commit/1328a7565cb736c6fbafbcd4b6e3ddeeb4236685))
* **vscode:** fix the broken package path ([fab3e73](https://github.com/simwai/biome-formatter-vscode/commit/fab3e73ce58482780304e8c52a01c8f9e0dc9dd1))
* **vscode:** lsp server path in quotes (only windows) ([#17126](https://github.com/simwai/biome-formatter-vscode/issues/17126)) ([676ae46](https://github.com/simwai/biome-formatter-vscode/commit/676ae464de0061e44c42a1624fc9f3ea3c2673cb))
* **vscode:** report problem more accurately  ([#1681](https://github.com/simwai/biome-formatter-vscode/issues/1681)) ([32efb96](https://github.com/simwai/biome-formatter-vscode/commit/32efb96a5e6746e3b80cdba2957ce72cbd53780c))
* **vscode:** resolve binary paths with node resolver ([#17970](https://github.com/simwai/biome-formatter-vscode/issues/17970)) ([7baf121](https://github.com/simwai/biome-formatter-vscode/commit/7baf12167f9ec88b3c55585522167fb4d2784e3a))
* **vscode:** search for `node_modules/.bin/oxlint.exe` too (bun setup) ([#17597](https://github.com/simwai/biome-formatter-vscode/issues/17597)) ([7d6a243](https://github.com/simwai/biome-formatter-vscode/commit/7d6a2431664930b7af8d99913197c1ae4626c115)), closes [#17596](https://github.com/simwai/biome-formatter-vscode/issues/17596)
* **vscode:** search for `oxlint` and `oxfmt` in every workspace directory ([#17760](https://github.com/simwai/biome-formatter-vscode/issues/17760)) ([1c88760](https://github.com/simwai/biome-formatter-vscode/commit/1c887609bc874adc28e05e7de3d3dd22b4786d6e))
* **vscode:** support json5 for oxfmt ([#18502](https://github.com/simwai/biome-formatter-vscode/issues/18502)) ([a54af06](https://github.com/simwai/biome-formatter-vscode/commit/a54af061ccaf28047085e9cd571a54dd71f1e4a1)), closes [#18488](https://github.com/simwai/biome-formatter-vscode/issues/18488)
* **vscode:** Update notification for client restart to specify tool. ([#18273](https://github.com/simwai/biome-formatter-vscode/issues/18273)) ([7564dd0](https://github.com/simwai/biome-formatter-vscode/commit/7564dd0417ca9e274fd0791ef8a7e0d847d8068f))
* **vscode:** Update package.json to restrict a few more config options. ([#18270](https://github.com/simwai/biome-formatter-vscode/issues/18270)) ([3f95d99](https://github.com/simwai/biome-formatter-vscode/commit/3f95d99c8a6d5244238b8cab7b61bf3645b5e92d))
* **vscode:** Update version info formatting. ([#18274](https://github.com/simwai/biome-formatter-vscode/issues/18274)) ([ef00538](https://github.com/simwai/biome-formatter-vscode/commit/ef00538f272215d6f21ba69b16c1d21f904ebf6a))
* **vscode:** use `fsPath` for workspace mapping ([#18728](https://github.com/simwai/biome-formatter-vscode/issues/18728)) ([3262ca3](https://github.com/simwai/biome-formatter-vscode/commit/3262ca365972e4438655db0e879a329fca59646a))
* **vscode:** use built-in `getWorkspaceFolder` for detecting the right workspace of a given uri ([#18583](https://github.com/simwai/biome-formatter-vscode/issues/18583)) ([6155e3a](https://github.com/simwai/biome-formatter-vscode/commit/6155e3a850c0cbd7d2d1b047c636988b2982059c))


### Features

* add `oxc.enable.oxlint` and `oxc.enable.oxfmt` to control each connection separately ([#32](https://github.com/simwai/biome-formatter-vscode/issues/32)) ([83cb182](https://github.com/simwai/biome-formatter-vscode/commit/83cb18242109e4218eebd63b93f2268ea50a8409))
* add `oxc.useExecPath` to run lsp with VS Code built-in node ([#139](https://github.com/simwai/biome-formatter-vscode/issues/139)) ([54ed092](https://github.com/simwai/biome-formatter-vscode/commit/54ed092393a82d0f4451ff4b49d1e1c191482f11))
* add `source.format.oxc` code action ([#164](https://github.com/simwai/biome-formatter-vscode/issues/164)) ([ec05e86](https://github.com/simwai/biome-formatter-vscode/commit/ec05e866db4ac589f8d69f2cd66fc620f825d937))
* Add a command to copy debug info to clipboard. ([#157](https://github.com/simwai/biome-formatter-vscode/issues/157)) ([436db68](https://github.com/simwai/biome-formatter-vscode/commit/436db68bc94a56265698b19f0ca8314765fe10d6))
* add agent-resources git submodule ([b1f083c](https://github.com/simwai/biome-formatter-vscode/commit/b1f083ce763e03d62738923fc18a926920e3e026))
* add option to control enable/disable oxc linter ([#1665](https://github.com/simwai/biome-formatter-vscode/issues/1665)) ([a206395](https://github.com/simwai/biome-formatter-vscode/commit/a206395982ed1105d9ed4a822be41d8729e0d8b4))
* add semantic-release and commitlint configuration ([#11](https://github.com/simwai/biome-formatter-vscode/issues/11)) ([3a8d0ec](https://github.com/simwai/biome-formatter-vscode/commit/3a8d0ec3f3f6e97f0eef3641b65e688c98413d97))
* add Yarn PnP binary discovery for oxlint and oxfmt ([#160](https://github.com/simwai/biome-formatter-vscode/issues/160)) ([79abcd6](https://github.com/simwai/biome-formatter-vscode/commit/79abcd680b3029321c3f70764f9987738e93db70)), closes [oxc-project/oxc-vscode#11](https://github.com/oxc-project/oxc-vscode/issues/11)
* **editor/vscode:** Replace existing output channel and trace output channel with a single LogOutputChannel ([#7196](https://github.com/simwai/biome-formatter-vscode/issues/7196)) ([fe0da59](https://github.com/simwai/biome-formatter-vscode/commit/fe0da596865e531bb132d98f9948150f681c634c)), closes [#7136](https://github.com/simwai/biome-formatter-vscode/issues/7136)
* **editor/vscode:** Support window/showMessage event ([#7085](https://github.com/simwai/biome-formatter-vscode/issues/7085)) ([0a56137](https://github.com/simwai/biome-formatter-vscode/commit/0a56137aa2c97bd06743af3ce840c56ea57e66fe))
* **editor:** add `oxc.fmt.experimental` flag ([#13923](https://github.com/simwai/biome-formatter-vscode/issues/13923)) ([019d17d](https://github.com/simwai/biome-formatter-vscode/commit/019d17da39ad77cd0697f2320c024c26c2641fd7))
* **editor:** add `oxc.path.node` option ([#15040](https://github.com/simwai/biome-formatter-vscode/issues/15040)) ([1e4ac60](https://github.com/simwai/biome-formatter-vscode/commit/1e4ac60339c7724d91e22352f1ae8d91a8bd7b34))
* **editor:** add `oxc.typeAware` option for workspaces ([#13147](https://github.com/simwai/biome-formatter-vscode/issues/13147)) ([427368d](https://github.com/simwai/biome-formatter-vscode/commit/427368d0040abdc8f6d2dfa7f59dd6128e351aed)), closes [#12914](https://github.com/simwai/biome-formatter-vscode/issues/12914) [#13274](https://github.com/simwai/biome-formatter-vscode/issues/13274)
* **editor:** add named fixes for code actions ([#10203](https://github.com/simwai/biome-formatter-vscode/issues/10203)) ([5edaab3](https://github.com/simwai/biome-formatter-vscode/commit/5edaab341e45dc969587a3818c236f194b4db6a1))
* **editor:** adjust oxlint oxfmt config file editor supporting ([#16616](https://github.com/simwai/biome-formatter-vscode/issues/16616)) ([15e990e](https://github.com/simwai/biome-formatter-vscode/commit/15e990ec8ed0af27ef6fc1caf5f9068ef90565c3))
* **editor:** Create a command to apply all auto-fixes for the current active text editor ([#7672](https://github.com/simwai/biome-formatter-vscode/issues/7672)) ([ca9d1a4](https://github.com/simwai/biome-formatter-vscode/commit/ca9d1a4255eeacfb7cc831b5d25f76f25b8f2412)), closes [#7456](https://github.com/simwai/biome-formatter-vscode/issues/7456)
* **editor:** Improve the status bar item for the VS Code extension by adding a tooltip. ([#15819](https://github.com/simwai/biome-formatter-vscode/issues/15819)) ([42544fe](https://github.com/simwai/biome-formatter-vscode/commit/42544feaedd1543cbfd0f80d5bb1d4f628a5a394))
* **editor:** Listen to config file changes and trigger a didChangeConfiguration update ([#6964](https://github.com/simwai/biome-formatter-vscode/issues/6964)) ([b017803](https://github.com/simwai/biome-formatter-vscode/commit/b0178038d68068b0396f6be8ff6b81ea34d88919))
* **editor:** Only watch .oxlintrc.json or user supplied config paths ([#9731](https://github.com/simwai/biome-formatter-vscode/issues/9731)) ([ba5a279](https://github.com/simwai/biome-formatter-vscode/commit/ba5a2795e2ba1707d6cdf88c8fd57888138236f0))
* **editors/vscode:** clear diagnostics on file deletion ([#6326](https://github.com/simwai/biome-formatter-vscode/issues/6326)) ([b9acf7b](https://github.com/simwai/biome-formatter-vscode/commit/b9acf7b657821d9baf8befbb54759474596f7cdc)), closes [#6325](https://github.com/simwai/biome-formatter-vscode/issues/6325)
* **editors/vscode:** update VSCode extention to use project's language server ([#6132](https://github.com/simwai/biome-formatter-vscode/issues/6132)) ([999a260](https://github.com/simwai/biome-formatter-vscode/commit/999a2608b3f24b670f375a1c808a149aa2f7e648)), closes [#3426](https://github.com/simwai/biome-formatter-vscode/issues/3426)
* **editors:** toggle client after vscode config changing ([#16162](https://github.com/simwai/biome-formatter-vscode/issues/16162)) ([f47959c](https://github.com/simwai/biome-formatter-vscode/commit/f47959cb23071251adece1bda84c87ce0182693a))
* **editor:** support `oxc.fmt.configPath` configuration ([#14639](https://github.com/simwai/biome-formatter-vscode/issues/14639)) ([8539312](https://github.com/simwai/biome-formatter-vscode/commit/853931263d09e55b7ff87f4671140f448fe9d2d6))
* **editor:** Support nested configs ([#9743](https://github.com/simwai/biome-formatter-vscode/issues/9743)) ([b4bdb37](https://github.com/simwai/biome-formatter-vscode/commit/b4bdb376bf26f7640bc4a05a013dde249a7fec3d))
* **editor:** support relative path for `oxc.path.server` ([#13542](https://github.com/simwai/biome-formatter-vscode/issues/13542)) ([71580d5](https://github.com/simwai/biome-formatter-vscode/commit/71580d572d556f5b4caeba5d7fa80febb2cbbdf5)), closes [#12849](https://github.com/simwai/biome-formatter-vscode/issues/12849)
* final surgical transformation of Oxc extension to Biome Formatter ([7406bc3](https://github.com/simwai/biome-formatter-vscode/commit/7406bc3c8950ca785c48335e6aa3d3a529f47a55))
* introduce `oxc.suppressProgramErrors` option  ([#108](https://github.com/simwai/biome-formatter-vscode/issues/108)) ([85db8d6](https://github.com/simwai/biome-formatter-vscode/commit/85db8d6450716170101897c3e3a74c4fc90ed54b))
* **language_server/editor:** support multi workspace folders ([#10875](https://github.com/simwai/biome-formatter-vscode/issues/10875)) ([e9ba9bc](https://github.com/simwai/biome-formatter-vscode/commit/e9ba9bc7b7bd2e2fd5997d1d6692e88cee7b0775))
* **language_server:** add `fix_kind` flag ([#10226](https://github.com/simwai/biome-formatter-vscode/issues/10226)) ([d340541](https://github.com/simwai/biome-formatter-vscode/commit/d3405418334478fd70c3c7f764692dcf27d83247))
* **language_server:** add `unusedDisableDirectives` option ([#11645](https://github.com/simwai/biome-formatter-vscode/issues/11645)) ([ac5e89b](https://github.com/simwai/biome-formatter-vscode/commit/ac5e89b2571fb6a9dbea7db56c5f47b54eef0442)), closes [#11618](https://github.com/simwai/biome-formatter-vscode/issues/11618)
* **language_server:** better fallback handling when passing invalid `Options` values ([#10930](https://github.com/simwai/biome-formatter-vscode/issues/10930)) ([37eb96d](https://github.com/simwai/biome-formatter-vscode/commit/37eb96d6be571f71dd269c90ff79d937b354bcec)), closes [#10386](https://github.com/simwai/biome-formatter-vscode/issues/10386)
* **language_server:** provide commands / code actions for unopened files ([#10815](https://github.com/simwai/biome-formatter-vscode/issues/10815)) ([7e5de46](https://github.com/simwai/biome-formatter-vscode/commit/7e5de461e58a9c63a697d9282a80dff84c122d08))
* **language_server:** request for workspace configuration when client did not send them in `initialize` ([#10789](https://github.com/simwai/biome-formatter-vscode/issues/10789)) ([7aba110](https://github.com/simwai/biome-formatter-vscode/commit/7aba110e5377fb77c409303f87e233673f7a5cdf))
* **language_server:** search for nested configurations by initialization ([#10120](https://github.com/simwai/biome-formatter-vscode/issues/10120)) ([5838fa3](https://github.com/simwai/biome-formatter-vscode/commit/5838fa30a3ac4250373989d626cce4c465e5d910))
* **language_server:** tell clients to watch for .oxlintrc.json files ([#11078](https://github.com/simwai/biome-formatter-vscode/issues/11078)) ([51b147a](https://github.com/simwai/biome-formatter-vscode/commit/51b147aef51c1a37347bb9a4eb354b6d9ff6be1d))
* **language_server:** use linter runtime ([#10268](https://github.com/simwai/biome-formatter-vscode/issues/10268)) ([ad83027](https://github.com/simwai/biome-formatter-vscode/commit/ad83027210e17815d808f72b6749ed26b9865771)), closes [#7118](https://github.com/simwai/biome-formatter-vscode/issues/7118)
* **language_server:** watch for files inside `.oxlintrc.json` extends ([#11226](https://github.com/simwai/biome-formatter-vscode/issues/11226)) ([60ad890](https://github.com/simwai/biome-formatter-vscode/commit/60ad890dfd70c60d88c7d483d6a946478d7c697c)), closes [#10373](https://github.com/simwai/biome-formatter-vscode/issues/10373)
* **linter/vscode:** run extension when JS configs are detected ([#18832](https://github.com/simwai/biome-formatter-vscode/issues/18832)) ([e3fcb42](https://github.com/simwai/biome-formatter-vscode/commit/e3fcb426db71abb53851aea1309ab63341cd0e90))
* **linter:** add  jsx-a11y settings ([#1668](https://github.com/simwai/biome-formatter-vscode/issues/1668)) ([98c0346](https://github.com/simwai/biome-formatter-vscode/commit/98c03460235800734a5f8bb40d944e5a2dcc2697)), closes [#1141](https://github.com/simwai/biome-formatter-vscode/issues/1141)
* **linter:** add fix for unused disable directive ([#11708](https://github.com/simwai/biome-formatter-vscode/issues/11708)) ([9f2bac6](https://github.com/simwai/biome-formatter-vscode/commit/9f2bac6814698f6fe9dc3252478617142d491725))
* **linter:** support `ignorePatterns` for nested configs ([#12210](https://github.com/simwai/biome-formatter-vscode/issues/12210)) ([6c311a5](https://github.com/simwai/biome-formatter-vscode/commit/6c311a59ec9321b84c9161f8f5ebbfea505296bd)), closes [#11067](https://github.com/simwai/biome-formatter-vscode/issues/11067) [#12857](https://github.com/simwai/biome-formatter-vscode/issues/12857) [#11969](https://github.com/simwai/biome-formatter-vscode/issues/11969)
* **linter:** support disable directives for type aware rules ([#14052](https://github.com/simwai/biome-formatter-vscode/issues/14052)) ([f83fe14](https://github.com/simwai/biome-formatter-vscode/commit/f83fe14cd06809c2748ed1a84d24eddf3fc2eee4)), closes [#13941](https://github.com/simwai/biome-formatter-vscode/issues/13941)
* **lsp:** support vue, astro and svelte ([#1923](https://github.com/simwai/biome-formatter-vscode/issues/1923)) ([acd303d](https://github.com/simwai/biome-formatter-vscode/commit/acd303d3d0052336a333ffdaaa96087a33b80186))
* monorepo fallback for binary discovery via package.json traversal ([#84](https://github.com/simwai/biome-formatter-vscode/issues/84)) ([1c42ecc](https://github.com/simwai/biome-formatter-vscode/commit/1c42ecc67b52f771fed06d1f0c8616d489f6a24c))
* **oxc_language_server:** implement `oxc.fixAll` workspace command ([#8858](https://github.com/simwai/biome-formatter-vscode/issues/8858)) ([b6a2e0a](https://github.com/simwai/biome-formatter-vscode/commit/b6a2e0ab108c728476a1d6ac30afec6029ea7c5e))
* **oxlint/lsp:** support `jsPlugins` ([#17840](https://github.com/simwai/biome-formatter-vscode/issues/17840)) ([baa6af8](https://github.com/simwai/biome-formatter-vscode/commit/baa6af868994f161d84d200705172be1aaf0297d))
* **oxlint:** add `--lsp` flag to run the language server ([#15611](https://github.com/simwai/biome-formatter-vscode/issues/15611)) ([5d25e36](https://github.com/simwai/biome-formatter-vscode/commit/5d25e36ad19feddd52e10bc23d36e64dc167d056))
* **release:** add pre-release option for alpha releases ([004c2a9](https://github.com/simwai/biome-formatter-vscode/commit/004c2a9f68db95bd0ad74c2519f7333ff1246d47))
* **release:** add prepare release workflow and auto-trigger release ([906248c](https://github.com/simwai/biome-formatter-vscode/commit/906248c5886fd10e31e0685ba9dd8da57b4886e6))
* restart complete tool after relevant vs code config changes ([#138](https://github.com/simwai/biome-formatter-vscode/issues/138)) ([df05b55](https://github.com/simwai/biome-formatter-vscode/commit/df05b555961e18db87c47bf306009af7f8eb4299))
* support untitled schema for oxfmt ([#56](https://github.com/simwai/biome-formatter-vscode/issues/56)) ([153a7ac](https://github.com/simwai/biome-formatter-vscode/commit/153a7ac91f94dae1e34cd0dfd03878685f698ed5))
* surgical transformation of Oxc extension to Biome Formatter ([c608bfc](https://github.com/simwai/biome-formatter-vscode/commit/c608bfcddef5b6ef7512757b78ceabd789edfa34))
* transform oxc vs code extension into a biome vs code extension ([197fbe4](https://github.com/simwai/biome-formatter-vscode/commit/197fbe4d96c81302f73d56dde1265003b33889ad))
* transform oxc vs code extension into a biome vs code extension ([3b45f0c](https://github.com/simwai/biome-formatter-vscode/commit/3b45f0cc904aa6b292f3f9442999986d7eea8f0e))
* transform oxc vs code extension into a biome vs code extension ([52e79a0](https://github.com/simwai/biome-formatter-vscode/commit/52e79a0bfba2716aa531818c6897130b3565ca40))
* update Biome to 2.4.9 and improve DX ([9b60c6e](https://github.com/simwai/biome-formatter-vscode/commit/9b60c6ed2a0559c3a5a4e3b50df594785462868b))
* **vscode/language_server:** add `tsConfigPath` option ([#12484](https://github.com/simwai/biome-formatter-vscode/issues/12484)) ([1fa86f6](https://github.com/simwai/biome-formatter-vscode/commit/1fa86f67d4c4ea46fe814b187d91914bdb4bca80))
* **vscode:** activate extension on more languages ([#17717](https://github.com/simwai/biome-formatter-vscode/issues/17717)) ([a40302a](https://github.com/simwai/biome-formatter-vscode/commit/a40302a09f0c612ca16913d5e90b959f847066ff))
* **vscode:** add `oxc.requireConfig` configuration ([#11700](https://github.com/simwai/biome-formatter-vscode/issues/11700)) ([23f1e64](https://github.com/simwai/biome-formatter-vscode/commit/23f1e64340f068fb17747303283028bac3373467)), closes [#11628](https://github.com/simwai/biome-formatter-vscode/issues/11628)
* **vscode:** add a option to control oxc lint timing ([#1659](https://github.com/simwai/biome-formatter-vscode/issues/1659)) ([9d0b441](https://github.com/simwai/biome-formatter-vscode/commit/9d0b441499f14e6020f7f1def1bafaf194e68729))
* **vscode:** add more supported languages to extension ([#17812](https://github.com/simwai/biome-formatter-vscode/issues/17812)) ([f4af0d2](https://github.com/simwai/biome-formatter-vscode/commit/f4af0d2b5f00c435c3a43c7aa4d55ea131015b9b)), closes [#17615](https://github.com/simwai/biome-formatter-vscode/issues/17615)
* **vscode:** add quick actions to status bar tooltip ([#15962](https://github.com/simwai/biome-formatter-vscode/issues/15962)) ([04c9eae](https://github.com/simwai/biome-formatter-vscode/commit/04c9eaedee4320160999748b28b68253b8d3e624))
* **vscode:** add support for tsgolint binary configuration ([#16921](https://github.com/simwai/biome-formatter-vscode/issues/16921)) ([53f534f](https://github.com/simwai/biome-formatter-vscode/commit/53f534fb98e09b75c574f1e390431f4d37dff7b4))
* **vscode:** allow config path configuration ([#2172](https://github.com/simwai/biome-formatter-vscode/issues/2172)) ([56bfeed](https://github.com/simwai/biome-formatter-vscode/commit/56bfeed2ac20b39141581a5947ecaf7a920773db)), closes [#1944](https://github.com/simwai/biome-formatter-vscode/issues/1944)
* **vscode:** auto-generate VSCode README configuration from package.json ([#16970](https://github.com/simwai/biome-formatter-vscode/issues/16970)) ([6002597](https://github.com/simwai/biome-formatter-vscode/commit/600259789ba589eadd36e33b0ef3ce6a58b3d9bf))
* **vscode:** change icon source ([#17998](https://github.com/simwai/biome-formatter-vscode/issues/17998)) ([5013822](https://github.com/simwai/biome-formatter-vscode/commit/501382233fcf1fdb1cc4c25bccdd756786877a2c))
* **vscode:** fallback to globally installed oxlint/oxfmt packages ([#18007](https://github.com/simwai/biome-formatter-vscode/issues/18007)) ([46d7319](https://github.com/simwai/biome-formatter-vscode/commit/46d731979414656e84c014ef9234fea200c76bce))
* **vscode:** provide config's schema to oxlint config files ([#4826](https://github.com/simwai/biome-formatter-vscode/issues/4826)) ([160468b](https://github.com/simwai/biome-formatter-vscode/commit/160468b2c4785cef0b1950efcbf3208679fb3fda))
* **vscode:** show language server version inside sidebar status item tooltip ([#17360](https://github.com/simwai/biome-formatter-vscode/issues/17360)) ([a347f34](https://github.com/simwai/biome-formatter-vscode/commit/a347f3414d1e291c5688c6b867d035f8ca9ca094))
* **vscode:** support `oxlint --lsp` ([#15680](https://github.com/simwai/biome-formatter-vscode/issues/15680)) ([1d995b3](https://github.com/simwai/biome-formatter-vscode/commit/1d995b37e9e9b4fa208dcfe4f9a433ff2c014ccf))
* **vscode:** support diagnostic pull mode ([#17211](https://github.com/simwai/biome-formatter-vscode/issues/17211)) ([bbb0919](https://github.com/simwai/biome-formatter-vscode/commit/bbb09199978a8b207bbbc9df773751ab0c67c60a))
* **vscode:** support lint vue file ([#1842](https://github.com/simwai/biome-formatter-vscode/issues/1842)) ([abc5b8f](https://github.com/simwai/biome-formatter-vscode/commit/abc5b8faa293916762ca6bc437a96d3afa8aeffd))
* **vscode:** sync formatter with supported files  ([#17615](https://github.com/simwai/biome-formatter-vscode/issues/17615)) ([6c1200c](https://github.com/simwai/biome-formatter-vscode/commit/6c1200cc0ae3117112f6708625aa526cf37b764f)), closes [#16729](https://github.com/simwai/biome-formatter-vscode/issues/16729)
* **vscode:** use icon to represent enabled status ([#1675](https://github.com/simwai/biome-formatter-vscode/issues/1675)) ([3972d4b](https://github.com/simwai/biome-formatter-vscode/commit/3972d4bd6606c4a8763dc2955995a71105f007a9))


### Performance Improvements

* **editor:** avoid sending `workspace/didChangeConfiguration` request when the server needs a restarts ([#10550](https://github.com/simwai/biome-formatter-vscode/issues/10550)) ([f3b998e](https://github.com/simwai/biome-formatter-vscode/commit/f3b998e44d9e725d36da8a67fb8ffc1452033a28))
* **vscode:** restrict searching for oxlint/oxfmt binaries only 3 levels deep + 10s timeout ([#17345](https://github.com/simwai/biome-formatter-vscode/issues/17345)) ([3ea1c10](https://github.com/simwai/biome-formatter-vscode/commit/3ea1c10a08f75416a855f7b9fed44cde996259d5))


### Reverts

* reverted package.json and related changes ([306e21f](https://github.com/simwai/biome-formatter-vscode/commit/306e21fe333b26ff768a9efaca7be554956ddef1))

# Changelog

## [1.52.0] - 2026-03-30

- Update Biome configuration and schema to 2.4.9.
- Add `biome.rage` command for better diagnostics.
- Expand document support to include Astro, Svelte, Vue, GraphQL, CSS, Markdown, and more.
- Improve developer experience with updated launch and task configurations.
- Refactor configuration handling to be more extensible for future Biome versions.

## [1.51.0] - 2024-03-28

- Initial release of Biome Formatter (transformed from Oxc extension).
- Unified Biome LSP integration.
- Branding and author update to simwai.
