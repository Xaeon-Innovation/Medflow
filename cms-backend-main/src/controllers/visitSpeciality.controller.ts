import { Response, Request } from "express";
import { log } from "../middleware/logger.middleware";
import { incrementTarget } from "../services/targetManagement.service";
import "../middleware/auth.middleware"; // Import to extend Request interface
import { prisma } from "../utils/database.utils";

export const getVisitSpecialities = async (res: Response) => {
  try {
    const visitSpecialities = await prisma.visitSpeciality.findMany({
      include: {
        visit: true,
        speciality: true,
        doctor: true,
      },
    });
    res.status(200).json({ visitSpecialities: visitSpecialities });
  } catch (err) {
    res.status(400).json({ error: err });
  }
};

export const getVisitSpecialityById = async (req: Request, res: Response) => {
  try {
    const visitSpeciality = await prisma.visitSpeciality.findUnique({
      where: {
        id: req.params.id,
      },
      include: {
        visit: true,
        speciality: true,
        doctor: true,
      },
    });
    res.status(200).json({ visitSpeciality: visitSpeciality });
  } catch (err) {
    res.status(400).json({ error: err });
  }
};

export const createVisitSpeciality = async (req: Request, res: Response) => {
  try {
    const newVisitSpeciality = await prisma.visitSpeciality.create({
      data: req.body.visitSpeciality,
      include: {
        visit: {
          include: {
            patient: {
              include: {
                salesPerson: true
              }
            }
          }
        },
        speciality: true,
        doctor: true
      }
    });


    // Find coordinator for this visit speciality
    // For now, we'll use the sales person as coordinator if they have coordinator role
    // In a real system, you'd have a separate coordinator assignment
    const coordinator = newVisitSpeciality.visit.patient.salesPersonId ? 
      await prisma.employee.findFirst({
        where: {
          id: newVisitSpeciality.visit.patient.salesPersonId,
          isActive: true,
          accountStatus: 'active',
          employeeRoles: {
            some: {
              role: 'coordinator',
              isActive: true
            }
          }
        }
      }) : null;

    if (coordinator) {
      // Create commission record for the coordinator
      const commissionDate = new Date().toISOString().split('T')[0];
      const commission = await prisma.commission.create({
        data: {
          employeeId: coordinator.id,
          amount: 1,
          type: 'VISIT_SPECIALITY_ADDITION',
          period: commissionDate,
          description: `Visit speciality addition commission for ${newVisitSpeciality.speciality.name}`,
          visitSpecialityId: newVisitSpeciality.id
        }
      });

      // Increment commission count for the coordinator
      await prisma.employee.update({
        where: { id: coordinator.id },
        data: {
          commissions: {
            increment: 1
          }
        }
      });


      // Increment target for specialties (coordinator)
      try {
        await incrementTarget({ category: 'specialties', actorId: coordinator.id });
      } catch (e) {
        console.warn('Target increment (specialties) skipped:', (e as Error).message);
      }
    }

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "CREATE_VISIT_SPECIALITY",
      entity_type: "Visit Speciality",
      entity_id: newVisitSpeciality.id,
      status: "Successful",
      description: "New Visit Speciality Created Successfully",
    });

    res.status(200).json({
      visitSpeciality: newVisitSpeciality,
      message: "New Visit Speciality Created Successfully",
    });
  } catch (err) {

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "CREATE_VISIT_SPECIALITY",
      entity_type: "Visit Speciality",
      entity_id: null,
      status: "Failed",
      description: "Failed to Create New Visit Speciality: " + err,
    });

    res.status(400).json({ error: err });
  }
};

export const updateVisitSpeciality = async (req: Request, res: Response) => {
  try {
    const updatedVisitSpeciality = await prisma.visitSpeciality.update({
      where: { id: req.body.visitSpeciality.id },
      data: req.body.visitSpeciality,
    });


    log({
      user_id: req.cookies.employee_id,
      user_name: req.cookies.employee_name,
      action: "Update",
      entity_type: "Visit Speciality",
      entity_id: updatedVisitSpeciality.id,
      status: "Successful",
      description: "Visit Speciality Data Updated Successfully",
    });

    res.status(200).json({
      visitSpeciality: updatedVisitSpeciality,
      message: "Visit Speciality Data Updated Successfully",
    });
  } catch (err) {

    log({
      user_id: req.cookies.employee_id,
      user_name: req.cookies.employee_name,
      action: "Update",
      entity_type: "Visit Speciality",
      entity_id: req.body.visitSpeciality.id,
      status: "Failed",
      description: "Failed to Update Visit Speciality Data: " + err,
    });

    res.status(400).json({ error: err });
  }
};

export const deleteVisitSpeciality = async (req: Request, res: Response) => {
  try {
    await prisma.visitSpeciality.delete({
      where: { id: req.params.id },
    });

    log({
      user_id: req.cookies.employee_id,
      user_name: req.cookies.employee_name,
      action: "Delete",
      entity_type: "Visit Speciality",
      entity_id: <any>req.params,
      status: "Successful",
      description: "Visit Speciality Deleted Successfully",
    });

    res.status(200).json({
      message: "Visit Speciality Deleted Successfully",
    });
  } catch (err) {

    log({
      user_id: req.cookies.employee_id,
      user_name: req.cookies.employee_name,
      action: "Delete",
      entity_type: "Visit Speciality",
      entity_id: <any>req.params,
      status: "Failed",
      description: "Failed to Delete Visit Speciality: " + err,
    });

    res.status(400).json({ error: err });
  }
};
