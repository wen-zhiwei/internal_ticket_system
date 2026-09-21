-- Demo data for the two core product capabilities:
-- workflow progression and cross-agent collaboration.
-- Run after 0005_autonomous_driving_demo.sql.
-- This migration is additive and never overwrites user-created records.

BEGIN;

INSERT INTO tickets (
    id, title, description, customer_name, customer_contact,
    priority, status, assignee_id, created_by_id, created_at, updated_at
)
VALUES
    (
        '10000000-0000-0000-0000-000000000005',
        'Robotaxi 夜间接驾失败',
        '客户反馈夜间预约 Robotaxi 后车辆未能按约到达，需要优先核查调度记录、车辆状态和接驾链路。',
        '晨星智能出行',
        '13800000005',
        'urgent',
        'open',
        NULL,
        '00000000-0000-0000-0000-000000000003',
        NOW() - INTERVAL '18 minutes',
        NOW() - INTERVAL '18 minutes'
    ),
    (
        '10000000-0000-0000-0000-000000000006',
        '自动驾驶服务中断，需技术协同',
        '客户反馈行程中自动驾驶服务中断，客服已收集行程时间和车辆编号，需要技术团队协同排查。',
        '路行科技',
        'support@luxing.example',
        'high',
        'in_progress',
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000003',
        NOW() - INTERVAL '5 hours',
        NOW() - INTERVAL '45 minutes'
    ),
    (
        '10000000-0000-0000-0000-000000000007',
        '安全员服务异常，需要客服跟进',
        '客户反馈上一单安全员服务体验异常，需要客服先联系客户确认事实，再同步主管跟进服务复盘。',
        '智行用户服务中心',
        'service@zhixing.example',
        'normal',
        'in_progress',
        '00000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000001',
        NOW() - INTERVAL '3 hours',
        NOW() - INTERVAL '30 minutes'
    ),
    (
        '10000000-0000-0000-0000-000000000008',
        'Robotaxi 重复扣费退款确认',
        '客户反馈同一行程出现两笔扣费，客服已完成订单和支付流水核对，等待客户确认退款到账。',
        '云途自动驾驶',
        'finance@yuntu.example',
        'high',
        'resolved',
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000002',
        NOW() - INTERVAL '1 day',
        NOW() - INTERVAL '2 hours'
    ),
    (
        '10000000-0000-0000-0000-000000000009',
        '订单状态未更新',
        '客户反馈行程已经结束，但订单状态仍停留在行程中，客服已完成核实并关闭本次问题。',
        '远航出行平台',
        'ops@yuanhang.example',
        'normal',
        'closed',
        '00000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000003',
        NOW() - INTERVAL '2 days',
        NOW() - INTERVAL '1 day'
    ),
    (
        '10000000-0000-0000-0000-000000000010',
        '车辆已到站但无法接驾',
        '客户反馈车辆已经到达上车点，但订单仍无法开始接驾，需要客服与调度同学共同确认定位和订单状态。',
        '未来出行实验室',
        'dispatch@futuremobility.example',
        'urgent',
        'in_progress',
        '00000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000003',
        NOW() - INTERVAL '6 hours',
        NOW() - INTERVAL '20 minutes'
    )
ON CONFLICT (id) DO NOTHING;

-- Operation history makes the workflow visible in the ticket detail page.
INSERT INTO ticket_events (ticket_id, actor_id, event_type, description, created_at)
SELECT seed.ticket_id, seed.actor_id, seed.event_type, seed.description, seed.created_at
FROM (
    VALUES
        ('10000000-0000-0000-0000-000000000005'::uuid, '00000000-0000-0000-0000-000000000003'::uuid, 'created', '创建了工单', NOW() - INTERVAL '18 minutes'),
        ('10000000-0000-0000-0000-000000000006'::uuid, '00000000-0000-0000-0000-000000000003'::uuid, 'created', '创建了工单', NOW() - INTERVAL '5 hours'),
        ('10000000-0000-0000-0000-000000000006'::uuid, '00000000-0000-0000-0000-000000000003'::uuid, 'assigned', '分配给 王芳，并开始处理', NOW() - INTERVAL '4 hours 40 minutes'),
        ('10000000-0000-0000-0000-000000000006'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, 'commented', '添加了一条评论：已确认行程日志，初步判断是自动驾驶服务切换异常。', NOW() - INTERVAL '2 hours'),
        ('10000000-0000-0000-0000-000000000006'::uuid, '00000000-0000-0000-0000-000000000003'::uuid, 'commented', '添加了一条评论：请继续补充车辆日志，技术结论出来后同步客户。', NOW() - INTERVAL '45 minutes'),
        ('10000000-0000-0000-0000-000000000007'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, 'created', '创建了工单', NOW() - INTERVAL '3 hours'),
        ('10000000-0000-0000-0000-000000000007'::uuid, '00000000-0000-0000-0000-000000000003'::uuid, 'assigned', '分配给 李娜，并开始处理', NOW() - INTERVAL '2 hours 40 minutes'),
        ('10000000-0000-0000-0000-000000000007'::uuid, '00000000-0000-0000-0000-000000000002'::uuid, 'commented', '添加了一条评论：已联系客户，正在确认具体服务时间和安全员信息。', NOW() - INTERVAL '30 minutes'),
        ('10000000-0000-0000-0000-000000000008'::uuid, '00000000-0000-0000-0000-000000000002'::uuid, 'created', '创建了工单', NOW() - INTERVAL '1 day'),
        ('10000000-0000-0000-0000-000000000008'::uuid, '00000000-0000-0000-0000-000000000003'::uuid, 'assigned', '分配给 王芳，并开始处理', NOW() - INTERVAL '23 hours'),
        ('10000000-0000-0000-0000-000000000008'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, 'commented', '添加了一条评论：已完成订单和支付流水核对，确认存在重复扣费。', NOW() - INTERVAL '4 hours'),
        ('10000000-0000-0000-0000-000000000008'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, 'status_changed', '状态变更为已解决', NOW() - INTERVAL '2 hours'),
        ('10000000-0000-0000-0000-000000000009'::uuid, '00000000-0000-0000-0000-000000000003'::uuid, 'created', '创建了工单', NOW() - INTERVAL '2 days'),
        ('10000000-0000-0000-0000-000000000009'::uuid, '00000000-0000-0000-0000-000000000003'::uuid, 'assigned', '分配给 李娜，并开始处理', NOW() - INTERVAL '47 hours'),
        ('10000000-0000-0000-0000-000000000009'::uuid, '00000000-0000-0000-0000-000000000002'::uuid, 'commented', '添加了一条评论：已确认订单状态同步完成，等待主管复核。', NOW() - INTERVAL '26 hours'),
        ('10000000-0000-0000-0000-000000000009'::uuid, '00000000-0000-0000-0000-000000000002'::uuid, 'status_changed', '状态变更为已解决', NOW() - INTERVAL '25 hours'),
        ('10000000-0000-0000-0000-000000000009'::uuid, '00000000-0000-0000-0000-000000000003'::uuid, 'status_changed', '状态变更为已关闭', NOW() - INTERVAL '1 day'),
        ('10000000-0000-0000-0000-000000000010'::uuid, '00000000-0000-0000-0000-000000000003'::uuid, 'created', '创建了工单', NOW() - INTERVAL '6 hours'),
        ('10000000-0000-0000-0000-000000000010'::uuid, '00000000-0000-0000-0000-000000000003'::uuid, 'assigned', '分配给 王芳，并开始处理', NOW() - INTERVAL '5 hours 40 minutes'),
        ('10000000-0000-0000-0000-000000000010'::uuid, '00000000-0000-0000-0000-000000000003'::uuid, 'reassigned', '从 王芳 改派给 李娜', NOW() - INTERVAL '2 hours'),
        ('10000000-0000-0000-0000-000000000010'::uuid, '00000000-0000-0000-0000-000000000002'::uuid, 'commented', '添加了一条评论：已接手排查，正在和调度同学核对车辆定位。', NOW() - INTERVAL '20 minutes')
) AS seed(ticket_id, actor_id, event_type, description, created_at)
WHERE EXISTS (SELECT 1 FROM tickets WHERE tickets.id = seed.ticket_id)
  AND NOT EXISTS (
      SELECT 1
      FROM ticket_events AS existing
      WHERE existing.ticket_id = seed.ticket_id
        AND existing.event_type = seed.event_type
        AND existing.description = seed.description
  );

-- Durable comments make the collaboration thread visible separately from the timeline.
INSERT INTO ticket_comments (ticket_id, author_id, body, created_at)
SELECT seed.ticket_id, seed.author_id, seed.body, seed.created_at
FROM (
    VALUES
        ('10000000-0000-0000-0000-000000000006'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, '已确认行程日志，初步判断是自动驾驶服务切换异常。', NOW() - INTERVAL '2 hours'),
        ('10000000-0000-0000-0000-000000000006'::uuid, '00000000-0000-0000-0000-000000000003'::uuid, '请继续补充车辆日志，技术结论出来后同步客户。', NOW() - INTERVAL '45 minutes'),
        ('10000000-0000-0000-0000-000000000007'::uuid, '00000000-0000-0000-0000-000000000002'::uuid, '已联系客户，正在确认具体服务时间和安全员信息。', NOW() - INTERVAL '30 minutes'),
        ('10000000-0000-0000-0000-000000000008'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, '已完成订单和支付流水核对，确认存在重复扣费。', NOW() - INTERVAL '4 hours'),
        ('10000000-0000-0000-0000-000000000009'::uuid, '00000000-0000-0000-0000-000000000002'::uuid, '已确认订单状态同步完成，等待主管复核。', NOW() - INTERVAL '26 hours'),
        ('10000000-0000-0000-0000-000000000010'::uuid, '00000000-0000-0000-0000-000000000002'::uuid, '已接手排查，正在和调度同学核对车辆定位。', NOW() - INTERVAL '20 minutes')
) AS seed(ticket_id, author_id, body, created_at)
WHERE EXISTS (SELECT 1 FROM tickets WHERE tickets.id = seed.ticket_id)
  AND NOT EXISTS (
      SELECT 1
      FROM ticket_comments AS existing
      WHERE existing.ticket_id = seed.ticket_id
        AND existing.author_id = seed.author_id
        AND existing.body = seed.body
  );

COMMIT;
