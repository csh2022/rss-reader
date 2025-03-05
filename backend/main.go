package main

import (
	"encoding/json"
	"io"
	"log"
	"net/http" // 添加这行导入
	_url "net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/mux"
	"github.com/mmcdole/gofeed"
	"github.com/rs/cors"

	"rss-reader/internal/rss"
)

var (
	rssList []string
	mu      sync.RWMutex
)

func proxyHandler(w http.ResponseWriter, r *http.Request) {
	url := r.URL.Query().Get("url")
	log.Printf("收到代理请求，URL: %s\n", url)

	if url == "" {
		log.Println("缺少URL参数")
		http.Error(w, "缺少URL参数", http.StatusBadRequest)
		return
	}

	client := &http.Client{
		Timeout: 10 * time.Second,
	}

	resp, err := client.Get(url)
	if err != nil {
		log.Printf("无法获取网页内容: %v\n", err)
		http.Error(w, "无法获取网页内容", http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("网页返回错误状态码: %d\n", resp.StatusCode)
		http.Error(w, "网页返回错误状态码", http.StatusInternalServerError)
		return
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("读取响应内容失败: %v\n", err)
		http.Error(w, "读取响应内容失败", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(body)
}

func main() {
	// 启动时加载 RSS 列表
	links, err := rss.LoadRSSLinks()
	if err != nil {
		log.Printf("启动时加载 RSS 列表失败: %v\n", err)
	} else {
		rssList = links
		log.Printf("启动时加载的 RSS 列表: %v\n", rssList)
	}

	r := mux.NewRouter()
	r.HandleFunc("/rss", getRSSFeed).Methods("GET")
	r.HandleFunc("/rss/list", listRSS).Methods("GET")
	r.HandleFunc("/rss/add", addRSS).Methods("POST")
	r.HandleFunc("/rss/remove", removeRSS).Methods("DELETE")
	r.HandleFunc("/proxy", proxyHandler).Methods("GET")
	r.Use(mux.CORSMethodMiddleware(r))

	handler := cors.New(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Content-Type"},
		AllowCredentials: true,
	}).Handler(r)

	log.Println("服务器启动在 :5050")
	log.Fatal(http.ListenAndServe(":5050", handler))
}

func getRSSFeed(w http.ResponseWriter, r *http.Request) {
	url := r.URL.Query().Get("url")
	log.Printf("收到获取RSS请求，URL: %s\n", url)

	if url == "" {
		log.Println("缺少URL参数")
		http.Error(w, "缺少URL参数", http.StatusBadRequest)
		return
	}

	fp := gofeed.NewParser()
	feed, err := fp.ParseURL(url)
	if err != nil {
		log.Printf("无法解析RSS源: %v\n", err)
		http.Error(w, "无法解析RSS源", http.StatusInternalServerError)
		return
	}

	// 处理每个条目的图片
	for i := range feed.Items {
		item := feed.Items[i]

		// 尝试从不同位置获取图片
		image := ""
		if item.Image != nil {
			image = item.Image.URL
		}
		if image == "" && len(item.Enclosures) > 0 {
			for _, enc := range item.Enclosures {
				if strings.HasPrefix(enc.Type, "image/") {
					image = enc.URL
					break
				}
			}
		}
		if image == "" {
			image = extractFirstImageFromHTML(item.Description)
		}

		// 处理相对路径
		if image != "" && !strings.HasPrefix(image, "http") {
			baseURL, err := _url.Parse(item.Link)
			if err == nil {
				imageURL, err := _url.Parse(image)
				if err == nil {
					image = baseURL.ResolveReference(imageURL).String()
				}
			}
		}

		// 如果仍然没有找到图片，使用默认图片
		if image == "" {
			image = "https://picsum.photos/120/80" // 使用更可靠的图片服务
		}

		// 将图片信息添加到条目中
		item.Custom = map[string]string{
			"image": image,
		}
	}

	log.Printf("成功获取RSS源: %s\n", feed.Title)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	json.NewEncoder(w).Encode(feed)
}

// 从HTML内容中提取第一个图片
func extractFirstImageFromHTML(html string) string {
	if html == "" {
		return ""
	}

	re := regexp.MustCompile(`<img[^>]+src="([^">]+)"`)
	matches := re.FindStringSubmatch(html)
	if len(matches) > 1 {
		return matches[1]
	}
	return ""
}

func listRSS(w http.ResponseWriter, r *http.Request) {
	log.Println("收到获取RSS列表请求")
	mu.RLock()
	defer mu.RUnlock()

	// 确保rssList不为nil
	if rssList == nil {
		rssList = []string{}
	}

	log.Printf("当前RSS列表: %v\n", rssList)

	// 确保正确编码响应
	if err := json.NewEncoder(w).Encode(rssList); err != nil {
		log.Printf("编码响应失败: %v\n", err)
		http.Error(w, "内部服务器错误", http.StatusInternalServerError)
		return
	}
}

// 修改 addRSS 函数
func addRSS(w http.ResponseWriter, r *http.Request) {
	log.Println("收到添加RSS源请求")
	log.Printf("请求方法: %s\n", r.Method)
	log.Printf("请求URL: %s\n", r.URL.String())
	log.Printf("请求头: %v\n", r.Header)

	var url string
	if err := json.NewDecoder(r.Body).Decode(&url); err != nil {
		log.Printf("添加RSS源失败，无效的请求: %v\n", err)
		http.Error(w, "无效的请求", http.StatusBadRequest)
		return
	}

	log.Printf("请求体: %s\n", url)
	mu.Lock()
	defer mu.Unlock()

	// 检查是否已存在
	for _, u := range rssList {
		log.Printf("检查RSS源: %s\n", u)
		if u == url {
			log.Printf("RSS源已存在: %s\n", url)
			http.Error(w, "RSS源已存在", http.StatusConflict)
			return
		}
	}

	log.Printf("开始添加RSS源: %s\n", url)

	// 先保存到文件
	if err := rss.SaveRSSLink(url); err != nil {
		log.Printf("保存RSS链接失败: %v\n", err)
		http.Error(w, "保存RSS链接失败", http.StatusInternalServerError)
		return
	}

	// 再添加到内存列表
	log.Printf("开始添加RSS源到内存列表: %s\n", url)
	rssList = append(rssList, url)
	log.Printf("成功添加RSS源: %s\n", url)
	log.Printf("当前RSS列表: %v\n", rssList)
	w.WriteHeader(http.StatusCreated)

	log.Printf("响应头: %v\n", w.Header())
}

// 修改 removeRSS 函数
func removeRSS(w http.ResponseWriter, r *http.Request) {
	url := r.URL.Query().Get("url")
	log.Printf("收到删除RSS源请求: %s\n", url)

	if url == "" {
		log.Println("缺少URL参数")
		http.Error(w, "缺少URL参数", http.StatusBadRequest)
		return
	}

	mu.Lock()
	defer mu.Unlock()

	// 从内存列表中删除
	for i, u := range rssList {
		if u == url {
			rssList = append(rssList[:i], rssList[i+1:]...)
			log.Printf("成功删除RSS源: %s\n", url)
			break
		}
	}

	// 更新文件
	if err := rss.RemoveRSSLink(url); err != nil {
		log.Printf("更新文件失败: %v\n", err)
		http.Error(w, "更新文件失败", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
