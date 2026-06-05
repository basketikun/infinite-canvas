package router

import (
	"net/http"

	"github.com/basketikun/infinite-canvas/handler"
	"github.com/basketikun/infinite-canvas/middleware"
	"github.com/gin-gonic/gin"
)

func New() *gin.Engine {
	router := gin.Default()
	router.RedirectTrailingSlash = false
	_ = router.SetTrustedProxies(nil)
	api := router.Group("/api")
	api.GET("/health", func(c *gin.Context) {
		c.String(http.StatusOK, "ok")
	})
	api.POST("/auth/register", gin.WrapF(handler.Register))
	api.POST("/auth/login", gin.WrapF(handler.Login))
	api.GET("/auth/linux-do/authorize", gin.WrapF(handler.LinuxDoAuthorize))
	api.GET("/auth/linux-do/callback", gin.WrapF(handler.LinuxDoCallback))
	api.GET("/auth/oidc/authorize", gin.WrapF(handler.OIDCAuthorize))
	api.GET("/auth/oidc/callback", gin.WrapF(handler.OIDCCallback))
	api.GET("/auth/me", middleware.OptionalAuth, gin.WrapF(handler.CurrentUser))
	api.GET("/settings", gin.WrapF(handler.Settings))
	api.GET("/media/references/:id", func(c *gin.Context) {
		handler.ReferenceMedia(c.Writer, c.Request, c.Param("id"))
	})
	api.HEAD("/media/references/:id", func(c *gin.Context) {
		handler.ReferenceMedia(c.Writer, c.Request, c.Param("id"))
	})
	v1 := api.Group("/v1", middleware.UserAuth)
	v1.POST("/images/generations", gin.WrapF(handler.AIImagesGenerations))
	v1.POST("/images/edits", gin.WrapF(handler.AIImagesEdits))
	v1.POST("/chat/completions", gin.WrapF(handler.AIChatCompletions))
	v1.POST("/audio/speech", gin.WrapF(handler.AIAudioSpeech))
	v1.POST("/videos", gin.WrapF(handler.AIVideos))
	v1.POST("/media/references", gin.WrapF(handler.UploadReferenceMedia))
	v1.GET("/videos/:id", func(c *gin.Context) {
		handler.AIVideo(c.Writer, c.Request, c.Param("id"))
	})
	v1.GET("/videos/:id/content", func(c *gin.Context) {
		handler.AIVideoContent(c.Writer, c.Request, c.Param("id"))
	})
	v1.GET("/membership/plans", gin.WrapF(handler.MembershipPlans))
	v1.GET("/membership/me", gin.WrapF(handler.MyMembership))
	v1.GET("/membership/orders", gin.WrapF(handler.MyMembershipOrders))
	v1.POST("/membership/orders", gin.WrapF(handler.CreateMembershipOrder))
	v1.POST("/membership/orders/:id/cancel", func(c *gin.Context) {
		handler.CancelMembershipOrder(c.Writer, c.Request, c.Param("id"))
	})
	v1.POST("/membership/orders/:id/mock-pay", func(c *gin.Context) {
		handler.MockPayMembershipOrder(c.Writer, c.Request, c.Param("id"))
	})
	v1.POST("/membership/orders/:id/refresh-pay", func(c *gin.Context) {
		handler.RefreshMembershipOrderPay(c.Writer, c.Request, c.Param("id"))
	})
	api.GET("/prompts", middleware.OptionalAuth, gin.WrapF(handler.Prompts))
	api.GET("/assets", middleware.OptionalAuth, gin.WrapF(handler.Assets))
	api.POST("/admin/login", gin.WrapF(handler.AdminLogin))

	api.GET("/leaderboard/images", gin.WrapF(handler.ImageGenerationLeaderboard))

	api.GET("/payments/zpay/notify", gin.WrapF(handler.ZPayNotify))
	api.POST("/payments/zpay/notify", gin.WrapF(handler.ZPayNotify))
	api.GET("/payments/zpay/return", gin.WrapF(handler.ZPayReturn))
	api.POST("/payments/alipay/notify", gin.WrapF(handler.AlipayNotify))
	api.GET("/payments/alipay/return", gin.WrapF(handler.AlipayReturn))
	api.POST("/payments/wechat/notify", gin.WrapF(handler.WechatNotify))

	admin := api.Group("/admin", middleware.AdminAuth)
	admin.GET("/users", gin.WrapF(handler.AdminUsers))
	admin.POST("/users", gin.WrapF(handler.AdminSaveUser))
	admin.POST("/users/:id/credits", func(c *gin.Context) {
		handler.AdminAdjustUserCredits(c.Writer, c.Request, c.Param("id"))
	})
	admin.DELETE("/users/:id", func(c *gin.Context) {
		handler.AdminDeleteUser(c.Writer, c.Request, c.Param("id"))
	})
	admin.GET("/credit-logs", gin.WrapF(handler.AdminCreditLogs))
	admin.POST("/credit-logs", gin.WrapF(handler.AdminSaveCreditLog))
	admin.DELETE("/credit-logs/:id", func(c *gin.Context) {
		handler.AdminDeleteCreditLog(c.Writer, c.Request, c.Param("id"))
	})
	admin.GET("/settings", gin.WrapF(handler.AdminSettings))
	admin.POST("/settings", gin.WrapF(handler.AdminSaveSettings))
	admin.POST("/settings/channel-models", gin.WrapF(handler.AdminChannelModels))
	admin.POST("/settings/channel-test", gin.WrapF(handler.AdminTestChannelModel))
	admin.GET("/prompt-categories", gin.WrapF(handler.AdminPromptCategories))
	admin.POST("/prompt-categories/sync", gin.WrapF(handler.AdminSyncPromptCategories))
	admin.GET("/prompts", gin.WrapF(handler.AdminPrompts))
	admin.POST("/prompts", gin.WrapF(handler.AdminSavePrompt))
	admin.POST("/prompts/batch-delete", gin.WrapF(handler.AdminDeletePrompts))
	admin.DELETE("/prompts/:id", func(c *gin.Context) {
		handler.AdminDeletePrompt(c.Writer, c.Request, c.Param("id"))
	})
	admin.GET("/assets", gin.WrapF(handler.AdminAssets))
	admin.POST("/assets", gin.WrapF(handler.AdminSaveAsset))
	admin.DELETE("/assets/:id", func(c *gin.Context) {
		handler.AdminDeleteAsset(c.Writer, c.Request, c.Param("id"))
	})
	admin.GET("/membership-plans", gin.WrapF(handler.AdminMembershipPlans))
	admin.POST("/membership-plans", gin.WrapF(handler.AdminSaveMembershipPlan))
	admin.DELETE("/membership-plans/:id", func(c *gin.Context) {
		handler.AdminDeleteMembershipPlan(c.Writer, c.Request, c.Param("id"))
	})
	admin.GET("/membership-orders", gin.WrapF(handler.AdminMembershipOrders))
	admin.POST("/membership-orders/:id/pay", func(c *gin.Context) {
		handler.AdminMarkOrderPaid(c.Writer, c.Request, c.Param("id"))
	})
	admin.DELETE("/membership-orders/:id", func(c *gin.Context) {
		handler.AdminDeleteMembershipOrder(c.Writer, c.Request, c.Param("id"))
	})

	router.NoRoute(middleware.NotFoundJSON)

	return router
}
