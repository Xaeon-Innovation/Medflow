import { Response, Request } from 'express';
import { log as logFunction } from '../middleware/logger.middleware';
import transactionService, {
  CreateTransactionData,
  TransactionFilter,
} from '../services/transaction.service';
import { getTransactionsBySalesPerson } from '../services/transaction.service';
import excelImportService from '../services/excelImport.service';

// Extend Request interface to include user
interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    name: string;
    role: string;
    roles: string[];
    isActive: boolean;
  };
}

const log = (req: AuthenticatedRequest, action: string, entity: string, entityId: string, status: string, details: string) => {
  logFunction({
    user_id: req.user?.id || 'system',
    user_name: req.user?.name || 'System',
    action: action,
    entity_type: entity,
    entity_id: entityId,
    status: status === 'Success' ? 'Successful' : 'Failed',
    description: details
  });
};

// Get transactions with filters
export const getTransactions = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { hospitalId, month, year, patientId, source, search, page, limit, isNew } = req.query;

    const filter: TransactionFilter = {
      ...(hospitalId && { hospitalId: hospitalId as string }),
      ...(month && { month: month as string }),
      ...(year && { year: year as string }),
      ...(patientId && { patientId: patientId as string }),
      ...(source && { source: source as 'manual' | 'excel' }),
      ...(search && { search: search as string }),
      ...(page && { page: parseInt(page as string, 10) }),
      ...(limit && { limit: parseInt(limit as string, 10) }),
      ...(isNew !== undefined && { isNew: isNew === 'true' || isNew === '1' }),
    };

    const result = await transactionService.getTransactionsByHospitalMonth(filter);

    log(req, 'GET_TRANSACTIONS', 'Transaction', 'N/A', 'Success', `Fetched ${result.transactions.length} transactions`);

    res.status(200).json({
      success: true,
      transactions: result.transactions,
      pagination: result.pagination,
      count: result.transactions.length
    });
  } catch (error: any) {
    console.error('Error fetching transactions:', error);
    log(req, 'GET_TRANSACTIONS', 'Transaction', 'N/A', 'Error', `Failed to fetch transactions: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transactions',
      error: error.message
    });
  }
};

// Get transaction by ID
export const getTransactionById = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const transaction = await transactionService.getTransactionWithDetails(id);

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    log(req, 'GET_TRANSACTION', 'Transaction', id, 'Success', 'Transaction fetched successfully');

    res.status(200).json({
      success: true,
      transaction
    });
  } catch (error: any) {
    console.error('Error fetching transaction:', error);
    log(req, 'GET_TRANSACTION', 'Transaction', req.params.id, 'Error', `Failed to fetch transaction: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transaction',
      error: error.message
    });
  }
};

// Get transactions by date range (keep for backward compatibility)
export const getTransactionsByDate = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { startDate, endDate } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Start date and end date are required'
      });
    }

    const result = await transactionService.getTransactionsByHospitalMonth({});
    
    // Filter by date range
    const filtered = result.transactions.filter((t: any) => {
      const createdAt = new Date(t.createdAt);
      const start = new Date(startDate);
      const end = new Date(endDate);
      return createdAt >= start && createdAt <= end;
    });

    res.status(200).json({
      success: true,
      transactions: filtered,
      count: filtered.length
    });
  } catch (error: any) {
    console.error('Error fetching transactions by date:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transactions',
      error: error.message
    });
  }
};

// Get transactions by sales person
export const getTransactionsBySalesPersonId = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { salesPersonId } = req.params;
    const { hospitalId, month, year, startDate, endDate, page, limit } = req.query;

    if (!salesPersonId) {
      return res.status(400).json({
        success: false,
        message: 'Sales person ID is required'
      });
    }

    const filter: TransactionFilter = {};
    if (hospitalId) filter.hospitalId = hospitalId as string;
    if (month) filter.month = month as string;
    if (year) filter.year = year as string;
    if (page) filter.page = parseInt(page as string);
    if (limit) filter.limit = parseInt(limit as string);

    const result = await getTransactionsBySalesPerson(salesPersonId, filter);

    res.status(200).json({
      success: true,
      data: result,
      message: `Found ${result.count} transactions for sales person`
    });
  } catch (error: any) {
    console.error('Error fetching transactions by sales person:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transactions by sales person',
      error: error.message
    });
  }
};

// Get patients with visits for transaction entry
export const getPatientsForTransactionEntry = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { hospitalId, month, year } = req.query;

    if (!hospitalId || !month || !year) {
      return res.status(400).json({
        success: false,
        message: 'Hospital ID, month, and year are required'
      });
    }

    const patients = await transactionService.getPatientsWithVisitsForTransaction(
      hospitalId as string,
      month as string,
      year as string
    );

    log(req, 'GET_PATIENTS_FOR_TRANSACTION', 'Transaction', 'N/A', 'Success', `Fetched ${patients.length} patients with visits`);

    res.status(200).json({
      success: true,
      patients,
      count: patients.length
    });
  } catch (error: any) {
    console.error('Error fetching patients for transaction entry:', error);
    log(req, 'GET_PATIENTS_FOR_TRANSACTION', 'Transaction', 'N/A', 'Error', `Failed to fetch patients: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch patients',
      error: error.message
    });
  }
};

// Get transaction summary
export const getTransactionSummary = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { hospitalId, month, year, patientId, source, search, isNew } = req.query;

    const filter: TransactionFilter = {
      ...(hospitalId && { hospitalId: hospitalId as string }),
      ...(month && { month: month as string }),
      ...(year && { year: year as string }),
      ...(patientId && { patientId: patientId as string }),
      ...(source && { source: source as 'manual' | 'excel' }),
      ...(search && { search: search as string }),
      ...(isNew !== undefined && { isNew: isNew === 'true' || isNew === '1' }),
    };

    const summary = await transactionService.getTransactionSummary(filter);

    log(req, 'GET_TRANSACTION_SUMMARY', 'Transaction', 'N/A', 'Success', 'Transaction summary fetched');

    res.status(200).json({
      success: true,
      summary
    });
  } catch (error: any) {
    console.error('Error fetching transaction summary:', error);
    log(req, 'GET_TRANSACTION_SUMMARY', 'Transaction', 'N/A', 'Error', `Failed to fetch summary: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transaction summary',
      error: error.message
    });
  }
};

// Get summary for all hospitals
export const getAllHospitalsSummary = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { month, year, isNew } = req.query;

    const filter: { month?: string; year?: string; isNew?: boolean } = {
      ...(month && { month: month as string }),
      ...(year && { year: year as string }),
      ...(isNew !== undefined && { isNew: isNew === 'true' || isNew === '1' }),
    };

    const summary = await transactionService.getAllHospitalsSummary(filter);

    log(req, 'GET_ALL_HOSPITALS_SUMMARY', 'Transaction', 'N/A', 'Success', 'All hospitals summary fetched');

    res.status(200).json({
      success: true,
      summary
    });
  } catch (error: any) {
    console.error('Error fetching all hospitals summary:', error);
    log(req, 'GET_ALL_HOSPITALS_SUMMARY', 'Transaction', 'N/A', 'Error', `Failed to fetch all hospitals summary: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch all hospitals summary',
      error: error.message
    });
  }
};

// Create transaction
export const createTransaction = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      patientId,
      hospitalId,
      month,
      year,
      totalRevenue,
      companyShare,
      eligibleAmount,
      referralShare,
      visitSpecialityIds,
      source,
      status
    } = req.body;

    if (!patientId || !hospitalId || !month || !year || 
        totalRevenue === undefined || companyShare === undefined || 
        eligibleAmount === undefined || referralShare === undefined) {
      return res.status(400).json({
        success: false,
        message: 'All required fields are missing'
      });
    }

    if (!req.user?.id) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    const transactionData: CreateTransactionData = {
      patientId,
      hospitalId,
      month,
      year,
      totalRevenue: parseFloat(totalRevenue),
      companyShare: parseFloat(companyShare),
      eligibleAmount: parseFloat(eligibleAmount),
      referralShare: parseFloat(referralShare),
      recordedById: req.user.id,
      visitSpecialityIds: visitSpecialityIds || [],
      source: source || 'manual',
      status: status || 'active',
    };

    const transaction = await transactionService.createTransaction(transactionData);

    if (!transaction) {
      return res.status(500).json({
        success: false,
        message: 'Failed to create transaction - no transaction returned'
      });
    }

    log(req, 'CREATE_TRANSACTION', 'Transaction', transaction.id, 'Success', 'Transaction created successfully');

    res.status(201).json({
      success: true,
      message: 'Transaction created successfully',
      transaction
    });
  } catch (error: any) {
    console.error('Error creating transaction:', error);
    log(req, 'CREATE_TRANSACTION', 'Transaction', 'N/A', 'Error', `Failed to create transaction: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to create transaction',
      error: error.message
    });
  }
};

// Bulk create transactions from Excel import
export const bulkCreateTransactions = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { transactions } = req.body;

    if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Transactions array is required and must not be empty'
      });
    }

    if (!req.user?.id) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    // Add recordedById to all transactions
    const transactionsWithUser = transactions.map((t: any) => ({
      ...t,
      recordedById: req.user!.id,
      totalRevenue: parseFloat(t.totalRevenue),
      companyShare: parseFloat(t.companyShare),
      eligibleAmount: parseFloat(t.eligibleAmount),
      referralShare: parseFloat(t.referralShare),
      source: t.source || 'excel',
      status: t.status || 'active',
    }));

    const createdTransactions = await transactionService.bulkCreateTransactions(transactionsWithUser);

    log(req, 'BULK_CREATE_TRANSACTIONS', 'Transaction', 'N/A', 'Success', `Created ${createdTransactions.length} transactions`);

    res.status(201).json({
      success: true,
      message: `Successfully created ${createdTransactions.length} transactions`,
      transactions: createdTransactions,
      count: createdTransactions.length
    });
  } catch (error: any) {
    console.error('Error bulk creating transactions:', error);
    log(req, 'BULK_CREATE_TRANSACTIONS', 'Transaction', 'N/A', 'Error', `Failed to bulk create transactions: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to bulk create transactions',
      error: error.message
    });
  }
};

// Update transaction
export const updateTransaction = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const {
      totalRevenue,
      companyShare,
      eligibleAmount,
      referralShare,
      visitSpecialityIds,
      status
    } = req.body;

    // Get existing transaction
    const existingTransaction = await transactionService.getTransactionWithDetails(id);

    if (!existingTransaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    // Update transaction amounts if provided
    if (totalRevenue !== undefined || companyShare !== undefined || 
        eligibleAmount !== undefined || referralShare !== undefined || status) {
      // Note: We'll need to add an update method to the service
      // For now, we'll use direct prisma update
      const { prisma } = require('../utils/database.utils');
      const { withDbRetry } = require('../utils/database.utils');

      await withDbRetry(async () => {
        await prisma.transaction.update({
          where: { id },
          data: {
            ...(totalRevenue !== undefined && { totalRevenue: parseFloat(totalRevenue) }),
            ...(companyShare !== undefined && { companyShare: parseFloat(companyShare) }),
            ...(eligibleAmount !== undefined && { eligibleAmount: parseFloat(eligibleAmount) }),
            ...(referralShare !== undefined && { referralShare: parseFloat(referralShare) }),
            ...(status && { status }),
            updatedAt: new Date(),
          }
        });
      });
    }

    // Update visit specialty links if provided
    if (visitSpecialityIds !== undefined) {
      await transactionService.linkTransactionToVisitSpecialities(id, visitSpecialityIds);
    }

    const updatedTransaction = await transactionService.getTransactionWithDetails(id);

    log(req, 'UPDATE_TRANSACTION', 'Transaction', id, 'Success', 'Transaction updated successfully');

    res.status(200).json({
      success: true,
      message: 'Transaction updated successfully',
      transaction: updatedTransaction
    });
  } catch (error: any) {
    console.error('Error updating transaction:', error);
    log(req, 'UPDATE_TRANSACTION', 'Transaction', req.params.id, 'Error', `Failed to update transaction: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to update transaction',
      error: error.message
    });
  }
};

// Delete transaction
export const deleteTransaction = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const transaction = await transactionService.getTransactionWithDetails(id);

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    const { prisma } = require('../utils/database.utils');
    const { withDbRetry } = require('../utils/database.utils');

    await withDbRetry(async () => {
      await prisma.transaction.delete({
        where: { id }
      });
    });

    log(req, 'DELETE_TRANSACTION', 'Transaction', id, 'Success', 'Transaction deleted successfully');

    res.status(200).json({
      success: true,
      message: 'Transaction deleted successfully'
    });
  } catch (error: any) {
    console.error('Error deleting transaction:', error);
    log(req, 'DELETE_TRANSACTION', 'Transaction', req.params.id, 'Error', `Failed to delete transaction: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to delete transaction',
      error: error.message
    });
  }
};

// Parse Excel file for transaction import
export const parseTransactionExcel = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { excelData, hospitalId, month, year } = req.body;

    if (!excelData || !Array.isArray(excelData)) {
      return res.status(400).json({
        success: false,
        message: 'Excel data array is required'
      });
    }

    if (!hospitalId || !month || !year) {
      return res.status(400).json({
        success: false,
        message: 'Hospital ID, month, and year are required'
      });
    }

    const result = await excelImportService.parseTransactionExcel(
      excelData,
      hospitalId,
      month,
      year
    );

    log(req, 'PARSE_TRANSACTION_EXCEL', 'Transaction', 'N/A', 'Success', `Parsed ${result.parsed.length} transactions, matched ${result.matched.length}`);

    res.status(200).json({
      success: true,
      result
    });
  } catch (error: any) {
    console.error('Error parsing transaction Excel:', error);
    log(req, 'PARSE_TRANSACTION_EXCEL', 'Transaction', 'N/A', 'Error', `Failed to parse Excel: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to parse transaction Excel file',
      error: error.message
    });
  }
};