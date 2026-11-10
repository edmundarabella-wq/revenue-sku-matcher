# 来源与依赖

## AI图片元标签

来源：用户提供的 [amazon-ai-metadata-tool](https://github.com/edmundarabella-wq/amazon-ai-metadata-tool)。

整合基线：`09954576a3279271c909aac95cefa137423db244`。

保留JPEG APP1 XMP与PNG iTXt XMP的无重压缩写入方案，以及指定关键词`contains-synthetic-performer`。整合后的处理模块位于`src/image-metadata.js`，界面位于`src/image-app.js`，不依赖原站点或远程iframe。

本工具使用独立的DOM命名空间、图片队列和输出文件；不会修改来源仓库。新增严格XML解析、完整关键词匹配、PNG CRC校验、异常图片保护、输出重名处理和资源释放。ZIP打包复用内置JSZip。

该功能只负责写入和校验指定XMP关键词，不自动判断图片是否为AI生成，也不保证平台审核结果。

## 装箱分配与JH出货匹配

来源为用户提供的装箱自动分配 HTML 和包含同一装箱功能的 JH 出货匹配工作台 v1.2。使用 JH 工作台的装箱实现，保留领星与工厂两种导出。复用工作台的出货、采购和匹配流程，两个入口共享内置工作台但分别保存本次输入。

导入到 src/shipping 的源代码不包含原始报表、订单样本或本机路径。已将演示内容替换为合成示例。保留独立文档及样式，避免覆盖工具箱原有样式和行为。

## 内置依赖

- SheetJS CE 0.20.3：出货表格读取和导出，许可证见 vendor/shipping/LICENSE。
- XlsxPopulate 1.21.0：装箱模板读写和工厂装箱单导出，许可证见 vendor/shipping/XLSX-POPULATE-LICENSE。

- JSZip：Excel压缩包读写和图片ZIP打包，许可证见`vendor/JSZIP-LICENSE.txt`。
- SAX：报表XML读取，许可证见`vendor/SAX-LICENSE.txt`。
- Lucide：界面图标，许可证见`vendor/LUCIDE-LICENSE.txt`。

构建产物包含上述依赖及其许可证，不从第三方CDN加载。
