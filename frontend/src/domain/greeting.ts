export function greetingForHour(hour: number) {
  if (hour >= 5 && hour < 12) return "早上好";
  if (hour >= 12 && hour < 14) return "中午好";
  if (hour >= 14 && hour < 18) return "下午好";
  return "晚上好";
}

export function currentGreeting(date = new Date()) {
  return greetingForHour(date.getHours());
}
