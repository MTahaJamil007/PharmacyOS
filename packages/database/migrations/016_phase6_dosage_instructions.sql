-- Optional patient dosage timing ("1+0+1 after meal") written at the counter. It is printed on the
-- receipt for the patient and has no effect on quantity, price, stock, or tax.
alter table sale_draft_items
  add column dosage_instruction text
  check (dosage_instruction is null or char_length(dosage_instruction) between 1 and 80);

alter table sale_items
  add column dosage_instruction text
  check (dosage_instruction is null or char_length(dosage_instruction) between 1 and 80);
