# Test Cases for Appointment Merge by Hospital Fix

This document describes test cases to verify that appointments are only merged when patient, date, and hospital all match.

## Test Setup

Before running these tests, ensure you have:
- At least 2 different hospitals in the database
- At least 1 patient in the database
- At least 2 different specialties in the database
- At least 2 different doctors in the database

## Test Case 1: Same Patient, Same Day, Different Hospitals - Should NOT Merge

**Objective**: Verify that creating appointments for the same patient on the same day at different hospitals results in separate appointments.

**Steps**:
1. Create an appointment for Patient A at Hospital 1 on Date X with Specialty 1
2. Create another appointment for Patient A at Hospital 2 on Date X with Specialty 2
3. Verify that two separate appointments exist (not merged)
4. Verify that Appointment 1 has Hospital 1 and Specialty 1
5. Verify that Appointment 2 has Hospital 2 and Specialty 2

**Expected Result**: Two separate appointments exist, each with the correct hospital and specialty.

## Test Case 2: Same Patient, Same Day, Same Hospital - Should Merge

**Objective**: Verify that creating appointments for the same patient on the same day at the same hospital merges specialties correctly.

**Steps**:
1. Create an appointment for Patient A at Hospital 1 on Date X with Specialty 1
2. Create another appointment for Patient A at Hospital 1 on Date X with Specialty 2
3. Verify that only one appointment exists (merged)
4. Verify that the appointment has Hospital 1
5. Verify that the appointment has both Specialty 1 and Specialty 2

**Expected Result**: One appointment exists with both specialties merged.

## Test Case 3: Same Patient, Same Day, Same Hospital, Different Times - Should Merge

**Objective**: Verify that appointments at the same hospital merge even with different scheduled times.

**Steps**:
1. Create an appointment for Patient A at Hospital 1 on Date X at 10:00 AM with Specialty 1
2. Create another appointment for Patient A at Hospital 1 on Date X at 2:00 PM with Specialty 2
3. Verify that only one appointment exists (merged)
4. Verify that the appointment has both specialties with their respective scheduled times

**Expected Result**: One appointment exists with both specialties at their respective times.

## Test Case 4: Same Patient, Different Days, Same Hospital - Should NOT Merge

**Objective**: Verify that appointments on different days do not merge even at the same hospital.

**Steps**:
1. Create an appointment for Patient A at Hospital 1 on Date X with Specialty 1
2. Create another appointment for Patient A at Hospital 1 on Date Y (different day) with Specialty 2
3. Verify that two separate appointments exist

**Expected Result**: Two separate appointments exist.

## Test Case 5: Bulk Merge Respects Hospital

**Objective**: Verify that the bulk duplicate merge function also respects hospital boundaries.

**Steps**:
1. Create multiple appointments for Patient A:
   - Appointment 1: Hospital 1, Date X, Specialty 1
   - Appointment 2: Hospital 1, Date X, Specialty 2
   - Appointment 3: Hospital 2, Date X, Specialty 3
   - Appointment 4: Hospital 2, Date X, Specialty 4
2. Run the bulk merge function
3. Verify that:
   - Appointments 1 and 2 are merged (same hospital)
   - Appointments 3 and 4 are merged (same hospital)
   - The two merged appointments remain separate (different hospitals)

**Expected Result**: Two merged appointments exist, one for each hospital, with their respective specialties.

## Test Case 6: Duplicate Specialty at Same Hospital - Should Not Create Duplicate

**Objective**: Verify that attempting to add the same specialty (same doctor, same time) to an existing appointment does not create a duplicate.

**Steps**:
1. Create an appointment for Patient A at Hospital 1 on Date X with Specialty 1, Doctor 1, at 10:00 AM
2. Attempt to create another appointment for Patient A at Hospital 1 on Date X with Specialty 1, Doctor 1, at 10:00 AM
3. Verify that only one AppointmentSpeciality record exists for this combination
4. Verify that the appointment's specialty count is correct

**Expected Result**: No duplicate AppointmentSpeciality records are created.

## Manual Testing via API

You can test these scenarios using the appointment creation API endpoint:

```bash
# Test Case 1: Different hospitals
POST /appointment
{
  "patientName": "Test Patient",
  "nationalId": "123456789",
  "phoneNumber": "1234567890",
  "hospitalId": "hospital-1-id",
  "salesPersonId": "sales-person-id",
  "scheduledDate": "2024-01-15",
  "appointmentSpecialities": [
    {
      "specialityId": "specialty-1-id",
      "doctorId": "doctor-1-id",
      "scheduledTime": "2024-01-15T10:00:00Z"
    }
  ]
}

# Then create another with different hospital
POST /appointment
{
  "patientName": "Test Patient",
  "nationalId": "123456789",
  "phoneNumber": "1234567890",
  "hospitalId": "hospital-2-id",  # Different hospital
  "salesPersonId": "sales-person-id",
  "scheduledDate": "2024-01-15",  # Same date
  "appointmentSpecialities": [
    {
      "specialityId": "specialty-2-id",
      "doctorId": "doctor-2-id",
      "scheduledTime": "2024-01-15T10:00:00Z"
    }
  ]
}
```

## Verification Queries

After running tests, verify the results using these database queries:

```sql
-- Check all appointments for a patient on a specific date
SELECT 
  a.id,
  a."patientId",
  a."hospitalId",
  h.name as hospital_name,
  a."scheduledDate",
  a.speciality,
  COUNT(aps.id) as specialty_count
FROM "Appointment" a
LEFT JOIN "Hospital" h ON a."hospitalId" = h.id
LEFT JOIN "AppointmentSpeciality" aps ON a.id = aps."appointmentId"
WHERE a."patientId" = 'patient-id-here'
  AND DATE(a."scheduledDate") = '2024-01-15'
GROUP BY a.id, a."patientId", a."hospitalId", h.name, a."scheduledDate", a.speciality
ORDER BY a."createdAt";

-- Check AppointmentSpeciality records for an appointment
SELECT 
  aps.id,
  aps."appointmentId",
  s.name as specialty_name,
  d.name as doctor_name,
  aps."scheduledTime"
FROM "AppointmentSpeciality" aps
JOIN "Speciality" s ON aps."specialityId" = s.id
JOIN "Doctor" d ON aps."doctorId" = d.id
WHERE aps."appointmentId" = 'appointment-id-here'
ORDER BY aps."scheduledTime";
```

