package rss

import (
	"encoding/json"
	"os"
	"sync"
)

var (
	storagePath = "rssLinks.json"
	mtx         sync.RWMutex
)

func LoadRSSLinks() ([]string, error) {
	mtx.Lock()
	defer mtx.Unlock()

	// 如果文件不存在，返回空列表
	if _, err := os.Stat(storagePath); os.IsNotExist(err) {
		return []string{}, nil
	}

	// 读取文件内容
	data, err := os.ReadFile(storagePath)
	if err != nil {
		return nil, err
	}

	// 解析JSON
	var links []string
	if err := json.Unmarshal(data, &links); err != nil {
		return nil, err
	}

	return links, nil
}

func SaveRSSLink(url string) error {
	mtx.Lock()
	defer mtx.Unlock()

	// 直接读取文件内容
	var links []string
	if _, err := os.Stat(storagePath); err == nil {
		data, err := os.ReadFile(storagePath)
		if err != nil {
			return err
		}
		if err := json.Unmarshal(data, &links); err != nil {
			return err
		}
	}

	// 检查是否已存在
	for _, link := range links {
		if link == url {
			return nil
		}
	}

	// 添加新链接
	links = append(links, url)
	data, err := json.Marshal(links)
	if err != nil {
		return err
	}

	// 原子性写入
	tmpPath := storagePath + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0644); err != nil {
		return err
	}
	return os.Rename(tmpPath, storagePath)
}

func RemoveRSSLink(url string) error {
	mtx.Lock()
	defer mtx.Unlock()

	// 加载现有链接
	links, err := LoadRSSLinks()
	if err != nil {
		return err
	}

	// 过滤掉要删除的链接
	newLinks := []string{}
	for _, link := range links {
		if link != url {
			newLinks = append(newLinks, link)
		}
	}

	// 写入文件
	data, err := json.Marshal(newLinks)
	if err != nil {
		return err
	}

	return os.WriteFile(storagePath, data, 0644)
}
