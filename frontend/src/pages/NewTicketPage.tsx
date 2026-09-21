import { type FormEvent, useEffect, useState } from "react";
import { ApiError } from "../api/client";
import {
  createTicket,
  type CreateTicketInput,
  type TicketPriority,
} from "../api/tickets";
import type { User } from "../api/users";
import {
  clearAssistantDraft,
  readAssistantDraft,
} from "../domain/assistantDraft";

type Props = {
  currentUser: User;
};

const initialForm: CreateTicketInput = {
  title: "",
  description: "",
  customer_name: "",
  customer_contact: "",
  priority: "normal",
};

function validate(form: CreateTicketInput) {
  const errors: Record<string, string> = {};
  const required: Array<[keyof CreateTicketInput, string, number]> = [
    ["title", "标题", 200],
    ["description", "问题描述", 10000],
    ["customer_name", "客户名称", 100],
    ["customer_contact", "联系方式", 200],
  ];

  for (const [field, label, maximum] of required) {
    const value = form[field].trim();
    if (!value) errors[field] = `${label}不能为空`;
    else if ([...value].length > maximum) {
      errors[field] = `${label}不能超过 ${maximum} 个字符`;
    }
  }
  return errors;
}

export function NewTicketPage({ currentUser }: Props) {
  const [assistantDraft] = useState(() => readAssistantDraft());
  const [form, setForm] = useState<CreateTicketInput>(() =>
    assistantDraft
      ? {
          title: assistantDraft.title,
          description: assistantDraft.description,
          customer_name: assistantDraft.customer_name,
          customer_contact: assistantDraft.customer_contact,
          priority: assistantDraft.priority,
        }
      : initialForm,
  );
  const [prefilledFromAssistant] = useState(() => Boolean(assistantDraft));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (assistantDraft) clearAssistantDraft();
  }, [assistantDraft]);

  function updateTextField(
    field: "title" | "description" | "customer_name" | "customer_contact",
    value: string,
  ) {
    setForm((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clientErrors = validate(form);
    if (Object.keys(clientErrors).length > 0) {
      setFieldErrors(clientErrors);
      setSubmitError("请先修正表单中的问题");
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    setFieldErrors({});
    try {
      const detail = await createTicket(currentUser.id, form);
      window.location.hash = `#/tickets/${detail.ticket.id}`;
    } catch (error) {
      if (error instanceof ApiError) {
        setSubmitError(error.message);
        setFieldErrors(error.fields ?? {});
      } else {
        setSubmitError("创建失败，请确认 Go API 与 PostgreSQL 已启动");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="page-stack narrow" aria-labelledby="new-ticket-heading">
      <div className="page-intro">
        <div>
          <p className="eyebrow">Create ticket</p>
          <h2 id="new-ticket-heading">新建工单</h2>
          <p>创建后状态固定为“待领取”，处理人为空，并同步写入创建历史。</p>
          {prefilledFromAssistant && (
            <div className="assistant-prefill-note" role="status">
              已带入助手整理的草稿，请核对信息后再提交。
            </div>
          )}
        </div>
        <a className="button ghost" href="#/tickets">
          返回工单中心
        </a>
      </div>

      <form className="form-card" noValidate onSubmit={handleSubmit}>
        <div className="form-section">
          <div className="section-heading">
            <span>01</span>
            <div>
              <h3>问题信息</h3>
              <p>清楚描述客户遇到的问题，方便后续客服快速接手。</p>
            </div>
          </div>
          <label className="field full-width">
            <span>
              工单标题 <b aria-hidden="true">*</b>
            </span>
            <input
              aria-invalid={Boolean(fieldErrors.title)}
              maxLength={200}
              placeholder="例如：Robotaxi 订单重复扣费"
              value={form.title}
              onChange={(event) => updateTextField("title", event.target.value)}
            />
            <small className={fieldErrors.title ? "field-error" : "field-help"}>
              {fieldErrors.title ?? `${[...form.title].length}/200`}
            </small>
          </label>
          <label className="field full-width">
            <span>
              问题描述 <b aria-hidden="true">*</b>
            </span>
            <textarea
              aria-invalid={Boolean(fieldErrors.description)}
              maxLength={10000}
              placeholder="请记录订单号、车辆或线路、发生时间、影响范围和已尝试的处理方式"
              rows={7}
              value={form.description}
              onChange={(event) =>
                updateTextField("description", event.target.value)
              }
            />
            <small
              className={fieldErrors.description ? "field-error" : "field-help"}
            >
              {fieldErrors.description ??
                `${[...form.description].length}/10000`}
            </small>
          </label>
        </div>

        <div className="form-section">
          <div className="section-heading">
            <span>02</span>
            <div>
              <h3>客户与优先级</h3>
              <p>SLA 从工单创建时间开始，按所选优先级计算。</p>
            </div>
          </div>
          <div className="form-grid">
            <label className="field">
              <span>
                客户名称 <b aria-hidden="true">*</b>
              </span>
              <input
                aria-invalid={Boolean(fieldErrors.customer_name)}
                maxLength={100}
                placeholder="客户或合作方名称"
                value={form.customer_name}
                onChange={(event) =>
                  updateTextField("customer_name", event.target.value)
                }
              />
              {fieldErrors.customer_name && (
                <small className="field-error">
                  {fieldErrors.customer_name}
                </small>
              )}
            </label>
            <label className="field">
              <span>
                联系方式 <b aria-hidden="true">*</b>
              </span>
              <input
                aria-invalid={Boolean(fieldErrors.customer_contact)}
                maxLength={200}
                placeholder="邮箱、手机号或其他联系方式"
                value={form.customer_contact}
                onChange={(event) =>
                  updateTextField("customer_contact", event.target.value)
                }
              />
              {fieldErrors.customer_contact && (
                <small className="field-error">
                  {fieldErrors.customer_contact}
                </small>
              )}
            </label>
          </div>
          <fieldset className="priority-picker">
            <legend>优先级</legend>
            {(
              [
                ["urgent", "紧急", "2 小时"],
                ["high", "高", "8 小时"],
                ["normal", "普通", "24 小时"],
                ["low", "低", "72 小时"],
              ] as Array<[TicketPriority, string, string]>
            ).map(([value, label, sla]) => (
              <label key={value} className={`priority-option ${value}`}>
                <input
                  checked={form.priority === value}
                  name="priority"
                  type="radio"
                  value={value}
                  onChange={() =>
                    setForm((current) => ({ ...current, priority: value }))
                  }
                />
                <span>
                  <strong>{label}</strong>
                  <small>SLA {sla}</small>
                </span>
              </label>
            ))}
          </fieldset>
        </div>

        {submitError && (
          <div className="form-alert" role="alert">
            <strong>无法创建工单</strong>
            <span>{submitError}</span>
          </div>
        )}

        <div className="form-actions">
          <span>创建人：{currentUser.name} · 新工单不会自动分配处理人</span>
          <div>
            <a className="button ghost" href="#/tickets">
              取消
            </a>
            <button
              className="button primary"
              disabled={isSubmitting}
              type="submit"
            >
              {isSubmitting ? "正在创建…" : "创建工单"}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
