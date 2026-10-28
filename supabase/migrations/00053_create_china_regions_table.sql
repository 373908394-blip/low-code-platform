-- 中国三级行政区划表（省/市/区县，含不设区地级市直辖的镇街作为第三级）
CREATE TABLE china_regions (
  code text PRIMARY KEY,
  name text NOT NULL,
  level int NOT NULL CHECK (level IN (1, 2, 3)),
  parent_code text REFERENCES china_regions(code),
  province_code text REFERENCES china_regions(code)
);

CREATE INDEX idx_china_regions_level ON china_regions(level);
CREATE INDEX idx_china_regions_parent ON china_regions(parent_code);

-- RLS：行政区划为静态公开数据，登录用户只读
ALTER TABLE china_regions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated 可读行政区划" ON china_regions
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "anon 可读行政区划" ON china_regions
  FOR SELECT TO anon USING (true);