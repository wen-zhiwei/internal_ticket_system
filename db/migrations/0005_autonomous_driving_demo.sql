-- Align the built-in demo records with the autonomous-driving customer-service scenario.
-- Only the four records shipped by 0002 are changed; user-created tickets are untouched.
BEGIN;

UPDATE tickets
SET title = 'Robotaxi 订单重复扣费',
    description = '客户反馈自动驾驶订单被重复扣费，需要核对订单费用明细并退回多收金额。',
    customer_name = '远山出行',
    customer_contact = 'ops@yuanshan.example'
WHERE id = '10000000-0000-0000-0000-000000000001';

UPDATE tickets
SET title = 'Robotaxi 接驾失败',
    description = '客户反馈已预约自动驾驶接驾，但车辆未能按约到达，需要核查调度与车辆状态。',
    customer_name = '云帆科技',
    customer_contact = 'fleet@yunfan.example'
WHERE id = '10000000-0000-0000-0000-000000000002';

UPDATE tickets
SET title = '自动驾驶服务偶发中断',
    description = '客户反馈行程中自动驾驶服务偶发退出，已提供行程时间和车辆编号，请协助排查。',
    customer_name = '星河智能',
    customer_contact = 'support@xinghe.example'
WHERE id = '10000000-0000-0000-0000-000000000003';

UPDATE tickets
SET title = '安全员服务异常',
    description = '客户反馈上一单安全员服务体验异常，问题已初步处理，需保留记录并跟进复盘。',
    customer_name = '青禾汽车',
    customer_contact = 'service@qinghe.example'
WHERE id = '10000000-0000-0000-0000-000000000004';

COMMIT;
