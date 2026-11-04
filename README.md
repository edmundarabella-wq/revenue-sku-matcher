# Amazon 本地工具箱

浏览器本地运行的工具集合：Revenue SKU匹配、ASIN映射库、AI图片元标签。站点为纯静态HTML，无业务服务器、上传接口、遥测SDK或外部CDN依赖。切换工具保留本次报表、匹配结果和图片队列。

## 数据边界

- Excel报表由浏览器File API读取，只在当前页面内存中解析、匹配和导出。
- 原报表不上传、不存入服务器。已确认的ASIN映射仅保存于当前浏览器localStorage，可手动导出JSON备份。
- 图片仅存在当前页面内存，不上传或持久保存。JPEG/PNG仅修改XMP，不重新压缩像素；支持写入后校验、单张下载和ZIP打包。上限为30张、单张50 MB、总计200 MB。
- 已确认映射受账号、站点和ASIN作用域约束，不跨账号混用。
- 修改SKU不会自动执行FIFO核销、税务分类或税额重算。
- 页面设置connect-src 'none'、form-action 'none'和no-referrer。正常访问网页仍会向静态托管服务发送页面请求，托管方可能记录常规访问日志；文件内容不随页面请求发送。
- 公开站点的前端源代码可被访问者查看。公开代码仓库不包含报表、映射备份、真实测试数据或个人配置。
- 站点域名与本地file URL的localStorage彼此隔离；切换访问方式前先导出映射备份，再在新地址导入。

## 构建和测试

```sh
node --test tests/engine.test.cjs
node build.cjs
```

构建产生单文件Revenue_SKU匹配工具.html，可直接打开，也可作为静态站点index.html发布。第三方JSZip、SAX和Lucide随代码内置，许可证原文位于vendor/并嵌入构建文件。

通用浏览器回归：安装Playwright并安装其Chromium后运行`npm run test:browser`，可用`TOOL_BROWSER_EXECUTABLE`指定已安装的浏览器。测试只生成合成图片，不含业务报表，覆盖元数据写入、像素不变、重复写入、损坏文件、ZIP重名、工具切换与移动布局。输出在被忽略的`tests/artifacts/`。

AI图片元标签来源和整合基线见`THIRD_PARTY.md`。来源仓库保留独立，工具箱不依赖原站点。

## GitHub Pages

构建同时生成docs/index.html及docs/.nojekyll。仓库Settings → Pages，选择Deploy from a branch，分支main、目录/docs。

Pages只发布docs目录，不发布原报表、测试截图或运行日志。每次更新先测试、构建，再提交源码和docs目录，GitHub会按Pages设置更新站点。

GitHub Free支持公开仓库的Pages；私有仓库需支持该功能的付费方案。仓库可见性由所有者决定，发布脚本不会自行更改。

## 发布约束

只同步源代码、构建文件、通用说明与使用合成数据的单元测试。不得提交报表、映射备份、业务CSV、浏览器截图、真实数据测试脚本、部署凭据或运行日志。

变更记录见CHANGELOG.md；使用流程见使用说明.md。
