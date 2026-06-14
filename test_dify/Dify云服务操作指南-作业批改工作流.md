# Dify 云服务操作指南 — 作业批改工作流

> 对应阶段一：纯多模态大模型 + Dify 工作流，快速验证批改效果

---

## 一、准备工作

### 1. 注册 Dify 云账号

- 访问 [cloud.dify.ai](https://cloud.dify.ai)
- 支持 Google / GitHub 账号直接登录，或邮箱注册
- 注册后进入主控制台

### 2. 接入大模型 API（关键步骤）

Dify 本身不提供模型，需要接入第三方大模型 API。

### 🔥 推荐模型（Qwen3-VL 系列，阿里云百炼）

**Qwen3-VL-Plus** 是本方案首选模型，一次调用同时完成"姓名提取 + 题目识别 + 批改归因"，**不需要额外商用 OCR API**。

| 模型 | 推荐用途 | 价格（输入/输出 每千tokens） | 单张成本 |
|---|---|---|---|
| **Qwen3-VL-Flash** | 批量提取学生姓名（预处理） | 0.00037 / 0.0029 元 | ~0.0003元 |
| **Qwen3-VL-Plus** ⭐ | 全页作业批改（主力模型） | 0.00146 / 0.0117 元 | **~0.003元** |
| **Qwen3-VL-235B-A22B** | 高难度推理题批改 | 0.0029 / 0.0117 元 | ~0.005元 |

**获取方式**：登录 [阿里云百炼平台](https://bailian.console.aliyun.com/) → API-KEY 管理 → 创建密钥

**Dify 配置**：模型供应商选择"通义千问"→ 粘贴 API Key → 启用

### 备选模型

| 模型 | 推荐理由 | 获取方式 |
|---|---|---|
| **豆包 doubao-vision** | 多模态，直接看图批改 | volcengine.com 申请 |
| **OpenAI GPT-4o** | 多模态强，但价格高 | platform.openai.com |

**操作步骤**：

```text
Dify 控制台 → 右上角头像 → 设置 → 模型供应商
  → 找到对应供应商 → 填入 API Key → 启用
```

> 建议先充 10-20 元额度足够跑几十次测试。

---

## 二、创建工作流应用

### 步骤

```text
① 控制台 → "工作室" → 点击"创建应用"
② 选择应用类型 → "工作流"（不是聊天助手，不是 Agent）
③ 填写名称：作业批改系统-MVP
④ 创建完成后进入工作流画布
```

---

## 三、工作流编排方案（MVP 版）

采用**两阶段流程**：先提取答案模板 → 老师确认 → 再批改学生作业。答案模板只需处理一次，后续批量批改无需重复传入。

---

### 第一阶段：答案模板提取（只需做一次）

老师上传答案图片，自动提取结构化答案模板，交给老师确认。

#### 整体流程

```text
开始节点（接收答案图片）
  ↓
LLM 节点①：从答案图片中提取题目列表
  ↓
代码节点①：解析为结构化 JSON
  ↓
结束节点：输出答案模板（老师确认后使用）
```

#### 节点配置

**节点 1：开始节点（Start）**

| 变量名            | 类型   | 说明                      |
| -------------- | ---- | ----------------------- |
| `answer_image` | File | 答案模板的图片（通过 Dify 文件上传传入） |

**节点 2：LLM 节点① — 提取答案模板**

```yaml
上下文：开始节点
变量映射：
  - answer_image → sys.answer_image
模型：Qwen3-VL-Plus
温度：0.1
```

**提示词（系统）**：
```
你是一位专业的教师，请仔细查看这张答案图片，提取每一道题的信息。
```

**提示词（用户）**：
```
请从图片中提取所有题目信息，按以下 JSON 格式输出：

{
  "subject": "数学",
  "grade": "初一",
  "questions": [
    {
      "qid": "1",
      "type": "objective",       // objective / calculation / subjective
      "score": 5,                // 本题满分
      "answer": "3.14",          // 参考答案
      "scoring_standard": "答案正确得5分，过程正确但答案错误得2分",
      "knowledge_point": "圆周率"
    }
  ],
  "total_score": 100
}
```

**节点 3：代码节点① — 解析输出**

```python
import json, re

def main(raw: str) -> dict:
    json_match = re.search(r'\{.*\}', raw, re.DOTALL)
    if json_match:
        raw = json_match.group()
    result = json.loads(raw)
    return {
        "template": result,
        "summary": f"共 {len(result.get('questions',[]))} 题，总分 {result.get('total_score',0)} 分"
    }
```

**节点 4：结束节点** — 输出完整的答案模板 JSON。

> 老师确认无误后，将此 JSON 设为批改工作流的默认值（或存入脚本配置），后续批改不再重复传入。

---

### 第二阶段：学生作业批改（批量执行）

开始节点中 `answer_template` 设置为默认值，每次调用只需传入学生图片。

#### 整体流程

```text
开始节点（接收学生图片，answer_template 设默认值）
  ↓
LLM 节点①：提取姓名 + 对照答案批改
  ↓
代码节点①：解析结果、统计分数
  ↓
LLM 节点②：错题归因
  ↓
代码节点②：组装最终报告
  ↓
结束节点
```

#### 节点配置

**节点 1：开始节点（Start）**

| 变量名 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `student_image` | File | — | 学生作业图片（通过 Dify 文件上传传入） |
| `answer_template` | String | `{"questions":[...]}` | **设默认值**，由第一阶段提取的结果填入 |

> 设置默认值后，API 调用时只需传 `student_image`，不需要再传 `answer_template`。

**节点 2：LLM 节点① — 多模态识别 + 姓名提取 + 批改**

```yaml
上下文：开始节点
变量映射：
  - student_image → sys.student_image
  - answer_template → sys.answer_template
模型：Qwen3-VL-Plus
温度：0.1
```

**提示词（系统）**：
```
你是一位专业的中学教师，正在批改学生作业。
请仔细查看作业图片，完成以下任务：

1. 提取作业纸上写的学生姓名和班级信息
2. 识别每一道题目的学生答案
3. 对照参考答案模板，逐题批改打分
4. 按 JSON 格式输出
```

**提示词（用户）**：
```
学生作业：{{#start.student_image#}}
参考答案模板：{{#start.answer_template#}}

输出格式：
{
  "student_name": "张三",
  "class_name": "初一1班",
  "questions": [
    {
      "qid": "1",
      "student_answer": "3.14",
      "student_score": 5,
      "is_correct": true,
      "wrong_type": null,
      "comment": "回答正确"
    }
  ],
  "student_total": 95,
  "overall_comment": "整体表现不错..."
}
```

---

#### 节点 3：代码节点① — 解析批改结果

```yaml
语言：Python
输入变量：llm_output（从 LLM 节点①的输出）
```

```python
import json
import re

def main(raw: str) -> dict:
    # 清理 LLM 输出，提取 JSON
    # 有时 LLM 会包在 ```json ``` 里
    json_match = re.search(r'\{.*\}', raw, re.DOTALL)
    if json_match:
        raw = json_match.group()
    
    result = json.loads(raw)
    
    # 统计信息
    total_questions = len(result.get("questions", []))
    correct_count = sum(1 for q in result.get("questions", []) if q.get("is_correct"))
    wrong_questions = [q for q in result.get("questions", []) if not q.get("is_correct")]
    
    return {
        "parsed_result": result,
        "statistics": {
            "total_questions": total_questions,
            "correct_count": correct_count,
            "wrong_count": total_questions - correct_count,
            "accuracy": round(correct_count / total_questions * 100, 1) if total_questions > 0 else 0
        },
        "wrong_questions": wrong_questions
    }
```

---

#### 节点 4：LLM 节点② — 错题归因分析

```yaml
上下文：代码节点①
变量映射：
  - 代码节点①输出的 wrong_questions → sys.wrong_questions
```

**提示词（系统）**：
```
你是教育分析专家，根据学生的错题信息，分析错误原因并给出改进建议。
```

**提示词（用户）**：
```
以下是学生的错题列表：
{{#code_node_1.wrong_questions#}}

请为每一道错题分析错误类型（概念误解/计算失误/审题错误/格式不规范），
并给出针对性的改进建议，输出 JSON：

{
  "error_analysis": [
    {
      "qid": "1",
      "error_type": "概念误解",
      "knowledge_point": "一元一次方程移项",
      "suggestion": "建议复习...",
      "recommended_exercises": "推荐做..."
    }
  ]
}
```

**温度 Temperature**：`0.3`

---

#### 节点 5：代码节点② — 组装最终报告

```yaml
语言：Python
输入变量：
  - statistics（从代码节点①）
  - error_analysis（从 LLM 节点②）
```

```python
def main(statistics: dict, error_analysis: dict) -> dict:
    report = {
        "score_summary": {
            "total_questions": statistics["total_questions"],
            "correct": statistics["correct_count"],
            "wrong": statistics["wrong_count"],
            "accuracy": statistics["accuracy"]
        },
        "error_analysis": error_analysis.get("error_analysis", []),
        "knowledge_gaps": list(set(
            e.get("knowledge_point", "") 
            for e in error_analysis.get("error_analysis", [])
        )),
        "suggestions": [
            e.get("suggestion", "")
            for e in error_analysis.get("error_analysis", [])
        ]
    }
    return report
```

---

#### 节点 6：结束节点（End）

**输出变量**：引用代码节点②的完整输出。

发布后外部调用会收到类似如下结果：

```json
{
  "result": {
    "score_summary": {
      "total_questions": 10,
      "correct": 8,
      "wrong": 2,
      "accuracy": 80.0
    },
    "error_analysis": [
      {
        "qid": "3",
        "error_type": "计算失误",
        "knowledge_point": "分数加减法",
        "suggestion": "建议加强通分练习"
      }
    ],
    "knowledge_gaps": ["分数加减法"],
    "suggestions": ["建议加强通分练习"]
  }
}
```

---

## 四、发布与调用

### 发布工作流

```text
画布右上角 → "发布"按钮 → 填写版本说明 → 确认发布
```

### 获取 API 调用方式

```text
发布后 → 左侧导航 → "API 访问"
  → 复制 API Secret Key（格式：app-xxxxx）
  → 复制 API 调用地址
```

### ⭐ 核心：Dify 直接文件上传（不需要图床）

Dify 支持直接上传本地图片，**无需先将图片上传到图床/CDN**。

**第一步：上传文件获取 file_id**（Python 示例）

```python
def upload_to_dify(file_path: str, api_key: str) -> str:
    """上传图片到 Dify，返回文件 ID"""
    url = "https://api.dify.ai/v1/files/upload"
    with open(file_path, "rb") as f:
        resp = requests.post(
            url,
            headers={"Authorization": f"Bearer {api_key}"},
            files={"file": (os.path.basename(file_path), f, "image/jpeg")},
            data={"user": "teacher", "type": "IMAGE"}
        )
    return resp.json()["id"]  # 返回文件 ID
```

**第二步：传入文件 ID 调用工作流**

```python
def run_workflow(file_id: str, api_key: str, workflow_url: str):
    resp = requests.post(
        workflow_url,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        },
        json={
            "inputs": {
                "student_image": {
                    "transfer_method": "local_file",
                    "upload_file_id": file_id,
                    "type": "image"
                }
                # answer_template 已在开始节点设置了默认值，无需传入
            },
            "response_mode": "blocking",
            "user": "teacher"
        }
    )
    return resp.json()
```

---

## 五、批量照片预处理（核心实战）

老师实际使用中，全班照片混在一个文件夹里，需要自动识别每张照片对应哪个学生。

### 完整流程

```text
📁 全班作业照片/          ← 老师把所有照片放这里
   ├── IMG_001.jpg
   ├── IMG_002.jpg
   └── ...

          ↓ python batch_process.py

① 遍历每张照片
② Qwen3-VL-Flash 提取学生姓名（~0.0003元/张）
③ 上传图片到 Dify（无需图床，直接本地文件上传）
④ 调用 Dify 批改工作流（答案模板用开始节点默认值，无需传入）
⑤ 导出全班批改报告（Excel）
```

### 完整脚本

```python
"""
全班作业批量批改脚本
用法：python batch_process.py
"""

import os, json, base64, time, requests
from datetime import datetime

# ===== 配置区 =====
PHOTO_DIR = r"D:\作业照片\20241015_初一1班数学"  # 照片文件夹
DIFY_API_URL = "https://api.dify.ai/v1/workflows/run"
DIFY_API_KEY = "app-xxxxx"                        # Dify API Key
DASHSCOPE_API_KEY = "sk-xxxxx"                    # 阿里云百炼 API Key
# 答案模板已在 Dify 开始节点设为默认值，无需在脚本中传入
# =================


def extract_name(image_path: str) -> str:
    """Qwen3-VL-Flash 提取学生姓名"""
    with open(image_path, "rb") as f:
        img_b64 = base64.b64encode(f.read()).decode()
    
    resp = requests.post(
        "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
        headers={"Authorization": f"Bearer {DASHSCOPE_API_KEY}", "Content-Type": "application/json"},
        json={
            "model": "qwen3-vl-flash",
            "input": {
                "messages": [{
                    "role": "user",
                    "content": [
                        {"image": f"data:image/jpeg;base64,{img_b64}"},
                        {"text": "这张作业照片上写的学生姓名是什么？只输出姓名。"}
                    ]
                }]
            }
        }
    )
    return resp.json()["output"]["choices"][0]["message"]["content"].strip()


def upload_to_dify(file_path: str) -> str:
    """上传图片到 Dify，返回文件 ID（无需图床）"""
    url = "https://api.dify.ai/v1/files/upload"
    with open(file_path, "rb") as f:
        resp = requests.post(
            url,
            headers={"Authorization": f"Bearer {DIFY_API_KEY}"},
            files={"file": (os.path.basename(file_path), f, "image/jpeg")},
            data={"user": "teacher", "type": "IMAGE"}
        )
    return resp.json()["id"]


def run_dify_workflow(file_id: str) -> dict:
    """传入 Dify 文件 ID 调用批改工作流（answer_template 使用开始节点默认值，无需传入）"""
    resp = requests.post(DIFY_API_URL, headers={
        "Authorization": f"Bearer {DIFY_API_KEY}",
        "Content-Type": "application/json"
    }, json={
        "inputs": {
            "student_image": {
                "transfer_method": "local_file",
                "upload_file_id": file_id,
                "type": "image"
            }
        },
        "response_mode": "blocking",
        "user": "teacher"
    })
    return resp.json()["data"]["outputs"]["result"]


def export_excel(results: list):
    """导出 Excel 报告"""
    try:
        from openpyxl import Workbook
        wb = Workbook()
        ws = wb.active
        ws.title = "批改汇总"
        ws.append(["学生姓名", "总分", "得分", "正确率", "正确题数", "总题数", "错题详情"])
        
        for r in results:
            s = r["result"]["score_summary"]
            errors = "; ".join([
                f"第{e['qid']}题({e['error_type']})"
                for e in r["result"].get("error_analysis", [])
            ])
            ws.append([r["student"], s["total_questions"]*10,
                       s["correct"]*10, f"{s['accuracy']}%",
                       s["correct"], s["total_questions"], errors])
        
        wb.save(f"批改报告_{datetime.now():%Y%m%d_%H%M}.xlsx")
        print("✅ 报告已导出")
    except ImportError:
        with open("批改结果.json", "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)


def main():
    images = sorted(f for f in os.listdir(PHOTO_DIR)
                    if f.lower().endswith(('.jpg', '.jpeg', '.png')))
    print(f"📸 共检测到 {len(images)} 张照片")
    
    results, fails = [], []
    
    for i, img_file in enumerate(images, 1):
        img_path = os.path.join(PHOTO_DIR, img_file)
        print(f"\n[{i}/{len(images)}] {img_file}")
        
        # 提取姓名
        try:
            name = extract_name(img_path)
            print(f"   → {name}")
        except Exception as e:
            print(f"   ❌ 姓名提取失败: {e}")
            fails.append(img_file)
            continue
        
        # 上传到 Dify + 批改
        try:
            file_id = upload_to_dify(img_path)
            result = run_dify_workflow(file_id)
            print(f"   ✅ 得分: {result['score_summary']['accuracy']}%")
            results.append({"student": name, "file": img_file, "result": result})
        except Exception as e:
            print(f"   ❌ 批改失败: {e}")
            fails.append(img_file)
        
        time.sleep(0.5)  # 避免限流
    
    print(f"\n✅ 完成！成功: {len(results)} 张，失败: {len(fails)} 张")
    export_excel(results)
    if fails:
        print(f"⚠️ 需人工处理: {fails}")


if __name__ == "__main__":
    main()
```

### 效果

老师只需执行 `python batch_process.py`，所有照片自动识别姓名、批改、出报告，**零手工整理**。

### 第一批测试重点关注

1. **手写体识别准确率** — 如果不理想，在提示词中增加"注意学生手写可能潦草"的说明，或换 Qwen3-VL-235B-A22B 旗舰模型
2. **数学公式** — 如果公式识别差，需单独接入 LaTeX-OCR
3. **打分一致性** — 同一份作业多跑几次，看分数是否稳定

### 常见调优手段

| 问题 | 调整方式 |
|---|---|
| 格式不对 | 在提示词里加 Few-shot 示例（给 1-2 条完美 JSON 样例） |
| 打分偏高/偏低 | 调整提示词语气："严格批改，按照中考标准" |
| 漏题 | 在提示词里明确"作业图片中共有 N 道题，必须每题都批改" |
| 响应太慢 | 把 `response_mode` 改为 `streaming`，流式展示结果 |

---

## 六、后续进阶路线

```text
MVP 纯 LLM + Dify（本周）
       ↓
接入 OCR 节点，客观题走规则判分（阶段二）
       ↓
引入复核 Agent，双 LLM 交叉验证（阶段二）
       ↓
核心模块独立开发，替换 Dify 节点（阶段三）
       ↓
全量私有化部署（阶段三）
```
