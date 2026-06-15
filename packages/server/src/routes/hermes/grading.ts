import Router from '@koa/router'
import * as ctrl from '../../controllers/hermes/grading'

export const gradingRoutes = new Router()

// Config
gradingRoutes.get('/api/hermes/grading/config', ctrl.getConfig)
gradingRoutes.put('/api/hermes/grading/config', ctrl.updateConfig)

// Class & assignment discovery
gradingRoutes.get('/api/hermes/grading/classes', ctrl.listClasses)
gradingRoutes.get('/api/hermes/grading/classes/:name/assignments', ctrl.listClassAssignments)
gradingRoutes.post('/api/hermes/grading/assignments/scan', ctrl.scanAssignments)

// Assignment operations
gradingRoutes.get('/api/hermes/grading/assignments/:id', ctrl.getAssignmentDetail)
gradingRoutes.post('/api/hermes/grading/assignments/:id/extract', ctrl.extractTemplateHandler)
gradingRoutes.get('/api/hermes/grading/assignments/:id/template', ctrl.getTemplateHandler)
gradingRoutes.put('/api/hermes/grading/assignments/:id/template', ctrl.updateTemplateHandler)
gradingRoutes.post('/api/hermes/grading/assignments/:id/grade', ctrl.startGrading)
gradingRoutes.get('/api/hermes/grading/assignments/:id/progress', ctrl.gradingProgress)

// Results
gradingRoutes.get('/api/hermes/grading/assignments/:id/report', ctrl.downloadReport)
gradingRoutes.get('/api/hermes/grading/results', ctrl.listResults)
gradingRoutes.get('/api/hermes/grading/results/:id', ctrl.getResultDetail)

// Growth records
gradingRoutes.get('/api/hermes/grading/students/:name/growth', ctrl.getStudentGrowth)
gradingRoutes.get('/api/hermes/grading/students/:name/growth/raw', ctrl.getStudentGrowthRaw)
gradingRoutes.post('/api/hermes/grading/students/:name/growth/analyze', ctrl.analyzeStudentGrowthHandler)
