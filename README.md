# @kasami/form-core

无 UI、无运行时依赖的 TypeScript 自定义表单核心。可以在浏览器、Node.js 和 Worker 中使用，不绑定 React、组件库、数据库或上传服务。

## 使用

```ts
import {
  compileDefinition, evaluateFields, validateAnswers, organizeAnswers,
  exportJSON, exportCSV, type FormDefinition,
} from '@kasami/form-core';

const definition: FormDefinition = {
  formatVersion: 1,
  id: 'application',
  revision: '1',
  defaultLocale: 'zh',
  title: { zh: '申请', en: 'Application' },
  groups: [{
    id: 'contact', title: '联系信息', fields: [
      { id: 'name', type: 'text', label: '姓名', required: true, maxLength: 100 },
      { id: 'artist', type: 'boolean', label: '申请画师' },
      { id: 'portfolio', type: 'attachment', label: '作品', maxItems: 5,
        maxBytes: 10 * 1024 * 1024, accept: ['image/*'],
        visibleWhen: { op: 'eq', field: 'artist', value: true }, required: true },
    ],
  }],
};
const compiled = compileDefinition(definition); // 每个版本只编译一次
const draft = { name: 'Example', artist: false };
const states = evaluateFields(compiled, draft);
const result = validateAnswers(compiled, draft);
if (result.valid) {
  const submission = { id: 'submission-1', formId: definition.id,
    revision: definition.revision, answers: result.answers };
  const groups = organizeAnswers(compiled, submission.answers, 'zh');
  const json = exportJSON([{ form: compiled, submission }]);
  const { csv, columns } = exportCSV([{ form: compiled, submission }], 'zh');
  // 网站负责保存、展示、Blob 下载以及权限控制。
}
```

## 定义和答案

- `validateDefinition(unknown)` 返回路径与错误码；`compileDefinition(unknown)` 出错时抛出 `DefinitionError`，成功时创建不可变副本。`CompiledForm` 必须由编译接口创建，不能从 JSON 直接反序列化。
- 定义顺序由 `groups` 和 `fields` 数组决定。支持 `text`、`textarea`、`number`、`select`、`multiselect`、`date`、`boolean`、`attachment`、`notice`。字段 ID 在整个表单中唯一，选项 ID 在字段内唯一。ID 使用字母开头的字母、数字、下划线或连字符。
- 文本可以是普通字符串或语言映射；映射必须包含 `defaultLocale`。`resolveText` 精确匹配所选语言，否则回退默认语言。所有文本都是纯文本，界面应转义显示。
- 定义未知属性会被拒绝，扩展格式应先升级核心；限制为 100 个分组、500 个字段、每字段 500 个选项，以及 16 层/5000 个条件节点。
- 答案为字段 ID 到 JSON 值的映射。数字必须是有限数字，不自动转换数字字符串；多选保存选项 ID 数组；日期保存真实的 `YYYY-MM-DD` 日历日期；文本保留原始内容。
- `undefined`、`null`、空白文本及空数组视为未回答；`false` 和 `0` 是有效答案。`required` 对布尔字段要求作答，并不要求值为 `true`；同意条款等业务规则由网站额外验证。
- `evaluateFields` 返回 `{ visible, required }`；显隐字段保留在网站草稿中。隐藏字段不会影响下游条件，提交时由 `validateAnswers` 剔除。必填规则为固定必填或条件必填，不会被条件取消固定必填。
- 条件支持 `and`/`or`、`empty`/`notEmpty`、`eq`/`neq`、数字比较和多选 `contains`。未回答或隐藏字段不满足比较（含 `neq`）；如需匹配未回答状态，使用 `empty`。循环依赖和不兼容的比较类型在编译时被拒绝。
- `validateAnswers` 返回字段级稳定错误码与参数，界面自行翻译。非法字段值不会进入返回答案；只有 `valid: true` 才能保存。未知字段与说明字段答案被剔除。`normalizeAnswers` 是抛错式规范化接口。

## 上传接入

`UploadAdapter` 接受浏览器 `File` 与 `{ field, signal, onProgress? }`，返回 `{ id, name, size, mime }`。上传函数可以调用网站现有的 managed assets、Server Action 或其他存储服务；核心本身不发送任何请求。

附件字段支持 `minItems`、`maxItems`、`maxBytes`（单个文件）及 MIME 列表（如 `image/*`），所有限制都可选。网站应同时提供服务端请求体限制和实际文件校验。附件答案只保留稳定引用，不保存访问 URL、二进制、临时 token 或 `File`。

`isAttachmentReference` 检查上传返回值的基础结构；完整字段限制由 `validateAnswers` 检查。身份授权、实际 MIME、文件归属、上传会话、取消后的孤立文件、删除和访问 URL 由网站负责。进度回调不强制上传实现支持。

## 历史版本与导出

网站必须为提交关联不可变定义版本或保存定义快照，禁止用相同 `id + revision` 覆盖已使用定义。新题目、选项或规则产生新 revision；核心 package 版本与表单 revision 是独立概念。服务端用自己取得的可信版本重新验证提交，不接受客户端提供的定义作为可信来源。

`organizeAnswers` 返回分组、题目、描述、原始值和纯文本显示值。选项按定义顺序展示翻译；布尔显示值是 `true`/`false`，由界面根据语言展示。没有业务提交时间、用户或审核状态的假设。

JSON 导出包含格式版本、去重的完整定义快照及提交。CSV 返回 `{ csv, columns }`：固定元数据列后是由表单 ID、修订号、字段 ID 组成的列键；列说明包含分组、题目、类型及选项翻译。混合历史版本各占自己的列，列顺序按首次遇到的定义及其字段顺序。数组存为 JSON，单选保留稳定选项 ID。CSV 对所有单元格加引号、转义双引号，用 CRLF 分行，并对可能被表格软件当作公式的内容添加单引号。

导出会拒绝版本不匹配、非法答案和同一修订号下冲突的快照。输入必须已由网站取得并授权；核心不查询数据库。大批量导出可由网站放入 Web Worker，不建议在服务端重复计算展示信息。

## 独立维护

```sh
npm install
npm run build
npm run typecheck
npm run lint
npm pack --dry-run
npm publish --registry http://localhost:4873
```

仅发布 `dist`、README、CHANGELOG 和 LICENSE。无 GitHub Actions。发布配置指向本机 registry，不会默认发布到公开 npm。

遵循语义化版本；`0.x` 阶段也需查看 CHANGELOG，兼容修复增加 patch，破坏性变更增加 minor，并明确迁移步骤。表单 JSON 格式升级使用 `formatVersion`；新增字段类型需要消费方 UI 同步支持。所有网站锁定确切 package 版本，经升级 PR 后重新构建部署。

本地仓库临时放在 template-next 的 `packages/form-core`，源码和配置自包含，可单独移动、克隆和发布。template-next 通过明确版本加 `linkWorkspacePackages` 链接匹配的本地版本，方便首次开发；独立发布后，消费项目应移除这个开发 checkout，直接从 registry 安装，避免继续维护源码副本。
