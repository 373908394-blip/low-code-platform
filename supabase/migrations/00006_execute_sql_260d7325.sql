ALTER TABLE profiles 
  DROP CONSTRAINT IF EXISTS profiles_department_id_fkey RESTRICT; ALTER TABLE profiles 
  ADD CONSTRAINT profiles_department_id_fkey
    FOREIGN KEY(department_id)
    REFERENCES departments (id)
    ON DELETE SET NULL;